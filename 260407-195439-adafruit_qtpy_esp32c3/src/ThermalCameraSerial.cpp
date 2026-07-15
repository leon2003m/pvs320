#include <Arduino.h>
#include "ThermalCameraSerial.h"

static const unsigned long FRAME_TIMEOUT_MS = 600;

// P6 contrast steps (index 0-7) used when translating PVS320 contrast to P6.
static const uint8_t P6_CONTRAST_STEPS[8] = {32, 64, 96, 128, 160, 192, 224, 255};

ThermalCameraSerial::ThermalCameraSerial(HardwareSerial& serialRef, int txPin, int rxPin, uint32_t baud)
  : camSerial(serialRef),
    lastFrameByteMs(0),
    requestStartedMs(0),
    firmwareUpdatedMs(0),
    modelUpdatedMs(0),
    currentRxPin(rxPin),
    cameraTxPin(txPin),
    cameraBaud(baud),
    debugMode(false),
    protocolMode(PROTOCOL_P6),
    waitingForResponse(false),
    lastRequestSucceeded(false),
    silentResponseCount(0),
    currentBrightness(120),
    currentContrast(3),
    currentEnhancement(3),
    currentPalette(0) {
}

void ThermalCameraSerial::printHex(uint8_t b) {
  if (b < 0x10) Serial.print('0');
  Serial.print(b, HEX);
}

void ThermalCameraSerial::beginCam(int rxPin) {
  camSerial.end();
  delay(50);
  camSerial.begin(cameraBaud, SERIAL_8N1, rxPin, cameraTxPin);
  delay(50);

  while (camSerial.available()) camSerial.read();

  currentRxPin = rxPin;

  Serial.print("Camera UART started. TX=");
  Serial.print(cameraTxPin);
  Serial.print(" RX=");
  Serial.println(currentRxPin);
}

void ThermalCameraSerial::begin() {
  beginCam(currentRxPin);
}

int ThermalCameraSerial::getTxPin() const {
  return cameraTxPin;
}

int ThermalCameraSerial::getRxPin() const {
  return currentRxPin;
}

void ThermalCameraSerial::setCameraPins(int txPin, int rxPin) {
  cameraTxPin = txPin;
  beginCam(rxPin);
  if (cameraTxPin == 0 || cameraTxPin == 1 || currentRxPin == 0 || currentRxPin == 1) {
    Serial.println("Warning: GPIO 0/1 are usually USB/console pins on ESP32-C3 boards.");
  }
}

void ThermalCameraSerial::toggleDebugMode() {
  debugMode = !debugMode;
  Serial.print("Debug: ");
  Serial.println(debugMode ? "ON" : "OFF");
}

bool ThermalCameraSerial::getDebugMode() const {
  return debugMode;
}

void ThermalCameraSerial::sendInit(bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    if (logToSerial) Serial.println("INIT ignored (P6 mode)");
    return;
  }
  uint8_t payload[] = {0x01, 0x01};
  sendCommand('W', 0x98, payload, sizeof(payload), logToSerial);
  if (logToSerial) Serial.println("Sent INIT");
}

void ThermalCameraSerial::sendFw(bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    if (logToSerial) Serial.println("FW query not supported (P6 mode)");
    return;
  }
  uint8_t payload[] = {0x00, 0x00};
  sendCommand('R', 0x5A, payload, sizeof(payload), logToSerial);
  if (logToSerial) Serial.println("Sent FW");
}

void ThermalCameraSerial::sendModel(bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    if (logToSerial) Serial.println("MODEL query not supported (P6 mode)");
    return;
  }
  uint8_t payload[] = {0x00, 0x00};
  sendCommand('R', 0x57, payload, sizeof(payload), logToSerial);
  if (logToSerial) Serial.println("Sent MODEL");
}

void ThermalCameraSerial::sendBrightness(uint8_t value, bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    // PVS320 brightness is 0-255; P6 brightness is 0-128 -> scale.
    uint8_t p6 = (uint8_t)((uint16_t)value * 128 / 255);
    sendP6Adjust(0x01, p6, false);
    currentBrightness = value;
    if (logToSerial) { Serial.print("Sent BRIGHTNESS(P6) "); Serial.println(value); }
    return;
  }
  uint8_t payload[] = {value, 0x00};
  sendCommand('W', 0x31, payload, sizeof(payload), logToSerial);
  currentBrightness = value;
  if (logToSerial) {
    Serial.print("Sent BRIGHTNESS ");
    Serial.println(value);
  }
}

void ThermalCameraSerial::sendContrast(uint8_t value, bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    // PVS320 contrast is an index 0-7; P6 wants the actual step value.
    uint8_t idx = value & 0x07;
    sendP6Adjust(0x02, P6_CONTRAST_STEPS[idx], false);
    currentContrast = value;
    if (logToSerial) { Serial.print("Sent CONTRAST(P6) "); Serial.println(value); }
    return;
  }
  uint8_t payload[] = {value, 0x80};
  sendCommand('W', 0x32, payload, sizeof(payload), logToSerial);
  currentContrast = value;
  if (logToSerial) {
    Serial.print("Sent CONTRAST ");
    Serial.println(value);
  }
}

void ThermalCameraSerial::sendEnhancement(uint8_t value, bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    // P6 has no enhancement/sharpening command; keep state for BLE display only.
    currentEnhancement = value;
    if (logToSerial) Serial.println("ENHANCEMENT ignored (P6 mode)");
    return;
  }
  uint8_t payload[] = {0x01, value};
  sendCommand('W', 0x29, payload, sizeof(payload), logToSerial);
  currentEnhancement = value;
  if (logToSerial) {
    Serial.print("Sent ENHANCEMENT ");
    Serial.println(value);
  }
}

void ThermalCameraSerial::sendPalette(uint8_t value, bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    sendP6Palette(value, false);
    currentPalette = value;
    if (logToSerial) { Serial.print("Sent PALETTE(P6) "); Serial.println(value); }
    return;
  }
  uint8_t payload[] = {value, 0x00};
  sendCommand('W', 0x23, payload, sizeof(payload), logToSerial);
  currentPalette = value;
  if (logToSerial) {
    Serial.print("Sent PALETTE ");
    Serial.println(value);
  }
}

void ThermalCameraSerial::sendZoom(uint8_t value, bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    // P6 zoom is 10-40 (0.1x steps, 1.0x-4.0x).
    //  - value 1-8   : legacy slider -> spread across the FULL range (finer than x10)
    //  - value 9-40  : direct P6 step (fine 0.1x control for an updated UI)
    uint16_t z;
    if (value <= 8) {
      z = 10 + (uint16_t)(value - 1) * 30 / 7; // 1->10 (1.0x) ... 8->40 (4.0x)
    } else {
      z = value;                               // direct P6 zoom step
    }
    if (z < 10) z = 10;
    if (z > 40) z = 40;
    sendP6Raw(0x2B, 0x00, (uint8_t)z, 0, false);
    if (logToSerial) { Serial.print("Sent ZOOM(P6) "); Serial.println(z); }
    return;
  }
  uint8_t payload[] = {value, 0x00};
  sendCommand('W', 0x44, payload, sizeof(payload), logToSerial);
  if (logToSerial) {
    Serial.print("Sent ZOOM ");
    Serial.println(value);
  }
}

void ThermalCameraSerial::sendScreenAdjust(bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    if (logToSerial) Serial.println("SCREEN_ADJUST not supported (P6 mode)");
    return;
  }
  uint8_t payload[] = {0x00, 0x00};
  sendCommand('W', 0x06, payload, sizeof(payload), logToSerial);
  if (logToSerial) Serial.println("Sent SCREEN_ADJUST");
}

void ThermalCameraSerial::sendManualAdjust(bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    sendP6Calibrate(0x02, 0, false); // P6 manual NUC
    if (logToSerial) Serial.println("Sent MANUAL_ADJUST(P6 NUC)");
    return;
  }
  uint8_t payload[] = {0x00, 0x00};
  sendCommand('W', 0x05, payload, sizeof(payload), logToSerial);
  if (logToSerial) Serial.println("Sent MANUAL_ADJUST");
}

void ThermalCameraSerial::sendAuto(bool on, bool logToSerial) {
  if (protocolMode == PROTOCOL_P6) {
    sendP6Calibrate(0x01, on ? 0x01 : 0x00, false); // P6 auto-cal toggle
    if (logToSerial) { Serial.print("Sent AUTO(P6) "); Serial.println(on ? "ON" : "OFF"); }
    return;
  }
  uint8_t payload[16] = {0};
  payload[0] = on ? 0x0D : 0x01;
  sendCommand('W', 0x67, payload, sizeof(payload), logToSerial);
  if (logToSerial) {
    Serial.print("Sent AUTO ");
    Serial.println(on ? "ON" : "OFF");
  }
}

void ThermalCameraSerial::setProtocolMode(ProtocolMode mode) {
  protocolMode = mode;
}

ThermalCameraSerial::ProtocolMode ThermalCameraSerial::getProtocolMode() const {
  return static_cast<ProtocolMode>(protocolMode);
}

void ThermalCameraSerial::sendP6Command(uint8_t cmd, uint8_t subCmd, uint8_t d0, uint8_t d1, bool logToSerial) {
  uint8_t pkt[13] = {0x55, cmd, subCmd, d0, d1, 0, 0, 0, 0, 0, 0, 0, 0xAA};
  uint8_t checksum = 0;
  for (int i = 0; i < 11; i++) {
    checksum = (uint8_t)(checksum + pkt[i]);
  }
  pkt[11] = checksum;

  camSerial.write(pkt, sizeof(pkt));
  camSerial.flush();

  if (logToSerial) {
    Serial.print("Sent P6 command 0x");
    printHex(cmd);
    Serial.print(" sub=0x");
    printHex(subCmd);
    if (d0 || d1) {
      Serial.print(" data=0x");
      printHex(d0);
      Serial.print(" 0x");
      printHex(d1);
    }
    Serial.println();
  }
}

void ThermalCameraSerial::sendP6Calibrate(uint8_t subCmd, uint8_t value, bool logToSerial) {
  sendP6Command(0x26, subCmd, value, 0, logToSerial);
}

void ThermalCameraSerial::sendP6Save(bool logToSerial) {
  sendP6Command(0x29, 0x00, 0, 0, logToSerial);
}

void ThermalCameraSerial::sendP6Adjust(uint8_t subCmd, uint8_t value, bool logToSerial) {
  sendP6Command(0x2A, subCmd, value, 0, logToSerial);
}

void ThermalCameraSerial::sendP6Zoom(uint8_t value, bool logToSerial) {
  // P6 zoom carries its value in d0 with subCmd 0x00 (matches the original sketch).
  sendP6Command(0x2B, 0x00, value, 0, logToSerial);
}

void ThermalCameraSerial::sendP6Palette(uint8_t value, bool logToSerial) {
  sendP6Command(0x2D, value, 0, 0, logToSerial);
}

void ThermalCameraSerial::sendP6Raw(uint8_t cmd, uint8_t subCmd, uint8_t d0, uint8_t d1, bool logToSerial) {
  sendP6Command(cmd, subCmd, d0, d1, logToSerial);
}

void ThermalCameraSerial::runP6Dpc(bool logToSerial) {
  if (logToSerial) Serial.println("P6 DPC: start");
  sendP6Command(0x26, 0x02, 0, 0, false); // Start DPC (CMD_CALIBRATE 0x02)
  delay(3000);                            // Dwell for camera processing
  sendP6Command(0x26, 0x03, 0, 0, false); // End DPC (CMD_CALIBRATE 0x03)
  delay(150);
  sendP6Command(0x29, 0x00, 0, 0, false); // Permanent save to camera core (CMD_SAVE)
  if (logToSerial) Serial.println("P6 DPC: done + saved");
}

String ThermalCameraSerial::getFirmwareVersion() const {
  return firmwareVersion;
}

String ThermalCameraSerial::getModelName() const {
  return modelName;
}

unsigned long ThermalCameraSerial::getFirmwareUpdatedMs() const {
  return firmwareUpdatedMs;
}

unsigned long ThermalCameraSerial::getModelUpdatedMs() const {
  return modelUpdatedMs;
}

uint8_t ThermalCameraSerial::getCurrentBrightness() const {
  return currentBrightness;
}

uint8_t ThermalCameraSerial::getCurrentContrast() const {
  return currentContrast;
}

uint8_t ThermalCameraSerial::getCurrentEnhancement() const {
  return currentEnhancement;
}

uint8_t ThermalCameraSerial::getCurrentPalette() const {
  return currentPalette;
}

bool ThermalCameraSerial::queryFirmware(unsigned long timeoutMs, uint8_t attempts) {
  unsigned long initialUpdatedMs = firmwareUpdatedMs;

  for (uint8_t attempt = 0; attempt < attempts; attempt++) {
    unsigned long before = firmwareUpdatedMs;
    sendFw(attempt == 0);

    unsigned long started = millis();
    while (millis() - started < timeoutMs) {
      update();
      if (firmwareUpdatedMs != before && firmwareVersion.length() && firmwareVersion != "not connected") {
        return true;
      }
      delay(1);
    }
  }

  if (firmwareUpdatedMs == initialUpdatedMs) {
    firmwareVersion = "not connected";
    firmwareUpdatedMs = millis();
  }

  return firmwareVersion != "not connected";
}

bool ThermalCameraSerial::queryModel(unsigned long timeoutMs, uint8_t attempts) {
  unsigned long initialUpdatedMs = modelUpdatedMs;

  for (uint8_t attempt = 0; attempt < attempts; attempt++) {
    unsigned long before = modelUpdatedMs;
    sendModel(attempt == 0);

    unsigned long started = millis();
    while (millis() - started < timeoutMs) {
      update();
      if (modelUpdatedMs != before && modelName.length() && modelName != "not connected") {
        return true;
      }
      delay(1);
    }
  }

  if (modelUpdatedMs == initialUpdatedMs) {
    modelName = "not connected";
    modelUpdatedMs = millis();
  }

  return modelName != "not connected";
}

bool ThermalCameraSerial::refreshIdentity(unsigned long timeoutMs) {
  bool modelOk = queryModel(timeoutMs, 2);
  bool firmwareOk = queryFirmware(timeoutMs, 2);
  return modelOk && firmwareOk;
}

bool ThermalCameraSerial::awaitResponse(unsigned long timeoutMs) {
  unsigned long started = millis();
  while (waitingForResponse && millis() - started < timeoutMs) {
    update();
    delay(1);
  }

  if (waitingForResponse) {
    checkFrameTimeout();
  }

  return !waitingForResponse && lastRequestSucceeded;
}

void ThermalCameraSerial::decodeFrame(const String& frame) {
  if (frame.length() < 8) {
    if (debugMode) Serial.println("ERR: frame too short");
    return;
  }

  uint8_t op  = (uint8_t)frame[1];
  uint8_t cmd = (uint8_t)frame[2];

  bool hasAck = false;
  int base = 3;
  if (frame.length() > 3 && (uint8_t)frame[3] == 'Y') {
    hasAck = true;
    base = 4;
  }

  if (frame.length() < base + 2 + 1 + 3) {
    if (debugMode) Serial.println("ERR: invalid frame");
    return;
  }

  uint16_t payloadLen =
      ((uint8_t)frame[base]) |
      (((uint8_t)frame[base + 1]) << 8);

  int payloadStart = base + 2;
  int checksumIndex = payloadStart + payloadLen;
  int endIndex = checksumIndex + 1;

  if (endIndex + 2 >= frame.length()) {
    if (debugMode) Serial.println("ERR: frame length mismatch");
    return;
  }

  if (debugMode) {
    Serial.print("op=");
    Serial.print((char)op);
    Serial.print(" cmd=0x");
    printHex(cmd);
    Serial.print(" ack=");
    Serial.println(hasAck ? "yes" : "no");

    Serial.print("payload: ");
    for (int i = 0; i < payloadLen; i++) {
      if (i) Serial.print(' ');
      printHex((uint8_t)frame[payloadStart + i]);
    }
    Serial.println();

    Serial.print("text: ");
  }

  String payloadText;
  String displayText;
  for (int i = 0; i < payloadLen; i++) {
    uint8_t b = (uint8_t)frame[payloadStart + i];
    if (b == 0) break;

    if (b >= 32 && b <= 126) {
      payloadText += (char)b;
      displayText += (char)b;
    } else if (debugMode) {
      displayText += '.';
    }
  }

  if (cmd == 0x5A && payloadText.length()) {
    firmwareVersion = payloadText;
    firmwareUpdatedMs = millis();
  } else if (cmd == 0x57 && payloadText.length()) {
    modelName = payloadText;
    modelUpdatedMs = millis();
  }

  bool logResponse = debugMode || silentResponseCount <= 0;
  if (silentResponseCount > 0) silentResponseCount--;

  if (logResponse && displayText.length()) {
    Serial.println(displayText);
  } else if (logResponse && debugMode) {
    Serial.println("(no text)");
  }

  lastRequestSucceeded = true;
}

void ThermalCameraSerial::checkFrameTimeout() {
  if (frameBuf.length()) {
    if (millis() - lastFrameByteMs < FRAME_TIMEOUT_MS) return;

    if (debugMode) {
      Serial.println();
      Serial.println("ERR: frame timeout");
    }

    frameBuf = "";
    waitingForResponse = false;
    lastRequestSucceeded = false;
    silentResponseCount = 0;
    return;
  }

  if (!waitingForResponse) return;
  if (millis() - requestStartedMs < FRAME_TIMEOUT_MS) return;

  if (debugMode) {
    Serial.println("ERR: response timeout");
  }

  waitingForResponse = false;
  lastRequestSucceeded = false;
  silentResponseCount = 0;
}

void ThermalCameraSerial::markRequestSent(bool logToSerial) {
  requestStartedMs = millis();
  waitingForResponse = true;
  lastRequestSucceeded = false;
  frameBuf = "";
  if (!logToSerial) silentResponseCount++;
}

uint8_t ThermalCameraSerial::checksumPayload(const uint8_t* payload, uint16_t payloadLen) const {
  uint8_t checksum = 0;
  for (uint16_t i = 0; i < payloadLen; i++) {
    checksum = (uint8_t)(checksum + payload[i]);
  }
  return checksum;
}

void ThermalCameraSerial::sendCommand(
  uint8_t op,
  uint8_t cmd,
  const uint8_t* payload,
  uint16_t payloadLen,
  bool logToSerial) {
  camSerial.write(0x23);
  camSerial.write(op);
  camSerial.write(cmd);
  camSerial.write((uint8_t)(payloadLen & 0xFF));
  camSerial.write((uint8_t)((payloadLen >> 8) & 0xFF));

  for (uint16_t i = 0; i < payloadLen; i++) {
    camSerial.write(payload[i]);
  }

  camSerial.write(checksumPayload(payload, payloadLen));
  camSerial.write(0x45);
  camSerial.write(0x4E);
  camSerial.write(0x44);
  camSerial.flush();
  markRequestSent(logToSerial);
}

void ThermalCameraSerial::update() {
  checkFrameTimeout();

  while (camSerial.available()) {
    uint8_t b = camSerial.read();
    lastFrameByteMs = millis();

    if (debugMode) {
      printHex(b);
      Serial.print(' ');
    }

    char c = (char)b;
    if (frameBuf.isEmpty()) {
      if (c != '#') continue;
    }

    frameBuf += c;
    if (frameBuf.endsWith("END")) {
      if (debugMode) {
        Serial.print("\nFRAME on RX ");
        Serial.print(currentRxPin);
        Serial.print(": ");

        for (size_t i = 0; i < frameBuf.length(); i++) {
          uint8_t x = (uint8_t)frameBuf[i];
          printHex(x);
          Serial.print(' ');
        }
        Serial.println();
      }

      decodeFrame(frameBuf);
      frameBuf = "";
      waitingForResponse = false;
    }
  }
}
