#include "ThermalCameraRotaryControl.h"

// ---- P6 command opcodes (from the original sketch) ----
#define CMD_CALIBRATE 0x26
#define CMD_SAVE      0x29
#define CMD_ADJUST    0x2A
#define CMD_ZOOM      0x2B
#define CMD_PALETTE   0x2D

// On-board LED is active low on the ESP32-C3 boards used here.
#define LED_OFF HIGH
#define LED_ON  LOW

// Contrast steps sent via CMD_ADJUST 0x02 (index 1 == 64 == stock neutral).
static const int CONTRAST_STEPS[] = {32, 64, 96, 128, 160, 192, 224, 255};

// The encoder library needs a plain ISR pointer, so bounce through a static
// instance pointer. Only one control surface exists on the device.
static ThermalCameraRotaryControl* g_rotaryInstance = nullptr;
static void IRAM_ATTR rotaryIsrTrampoline() {
  if (g_rotaryInstance) g_rotaryInstance->handleEncoderIsr();
}

ThermalCameraRotaryControl::ThermalCameraRotaryControl(ThermalCameraSerial& cameraRef,
                                                       ThermalCameraOta& otaRef,
                                                       uint8_t rotaryAPin,
                                                       uint8_t rotaryBPin,
                                                       uint8_t rotarySwPin,
                                                       uint8_t thumbPin,
                                                       uint8_t ledPin)
  : camera(cameraRef),
    ota(otaRef),
    encoder(rotaryAPin, rotaryBPin, rotarySwPin, -1, 4),
    rotaryA(rotaryAPin),
    rotaryB(rotaryBPin),
    rotarySw(rotarySwPin),
    thumbBtn(thumbPin),
    led(ledPin),
    brightness(64),
    contrastIdx(1),
    palette(1),
    zoomVal(10),
    autoCalEnabled(false),
    thumbDownTime(0),
    encDownTime(0),
    lastBtnPressTime(0),
    thumbActionCooldown(0),
    thumbWasInteracted(false),
    b5s(false),
    b10s(false) {
}

void ThermalCameraRotaryControl::handleEncoderIsr() {
  encoder.readEncoder_ISR();
}

void ThermalCameraRotaryControl::begin() {
  g_rotaryInstance = this;

  // Auto-cal preference persists in its own NVS namespace.
  preferences.begin("p6rotary", false);
  autoCalEnabled = preferences.getBool("autocal", false);

  pinMode(rotaryA, INPUT_PULLUP);
  pinMode(rotaryB, INPUT_PULLUP);
  pinMode(rotarySw, INPUT_PULLUP);
  pinMode(thumbBtn, INPUT_PULLUP);
  pinMode(led, OUTPUT);
  digitalWrite(led, LED_OFF);

  encoder.begin();
  encoder.setup(rotaryIsrTrampoline);
  encoder.setBoundaries(-100000, 100000, false);
  encoder.setEncoderValue(0);

  // Restore the saved auto-cal state on the camera (P6 CMD_CALIBRATE 0x01).
  camera.sendP6Calibrate(0x01, autoCalEnabled ? 0x01 : 0x00, false);

  Serial.print("Rotary control ready. AutoCal=");
  Serial.println(autoCalEnabled ? "on" : "off");
}

// --- Dead Pixel Correction routine (blocks ~3.5s, matches the sketch) ---
void ThermalCameraRotaryControl::runDpc() {
  Serial.println("DPC: start");
  camera.sendP6Calibrate(0x02, 0, false); // Start DPC
  for (int i = 0; i < 15; i++) {
    digitalWrite(led, LED_ON);  delay(100);
    digitalWrite(led, LED_OFF); delay(100);
  }
  camera.sendP6Calibrate(0x03, 0, false); // End DPC
  delay(150);
  camera.sendP6Save(false);               // Permanent save to camera core

  for (int i = 0; i < 3; i++) {
    digitalWrite(led, LED_ON);  delay(300);
    digitalWrite(led, LED_OFF); delay(200);
  }
  Serial.println("DPC: done + saved");
}

void ThermalCameraRotaryControl::update() {
  unsigned long now = millis();

  // -------- Status LED: solid while the OTA hotspot is up --------
  digitalWrite(led, ota.isActive() ? LED_ON : LED_OFF);

  bool thumbPressed = (digitalRead(thumbBtn) == LOW);
  bool encPressed   = (digitalRead(rotarySw) == LOW);
  int delta = encoder.encoderChanged();

  // -------- 1. ROTATION (Zoom or Brightness) --------
  if (delta != 0) {
    if (thumbPressed) {
      thumbWasInteracted = true;
      brightness = constrain(brightness + delta, 0, 128);
      camera.sendP6Adjust(0x01, (uint8_t)brightness, false);
      Serial.print("Brightness "); Serial.println(brightness);
    } else {
      zoomVal = constrain(zoomVal + delta, 10, 40);
      // P6 zoom carries the value in d0 with subCmd 0x00 (byte-exact sketch framing).
      camera.sendP6Raw(CMD_ZOOM, 0x00, (uint8_t)zoomVal, 0, false);
      Serial.print("Zoom "); Serial.println(zoomVal);
    }
  }

  // -------- 2. ENCODER BUTTON (Contrast / Palette / DPC) --------
  if (encPressed) {
    if (encDownTime == 0) encDownTime = now;
    // Trigger DPC: hold Thumb + hold Encoder for 3 seconds
    if (thumbPressed && (now - encDownTime > 3000)) {
      thumbWasInteracted = true;
      runDpc();
      encDownTime = 0;
    }
  } else {
    if (encDownTime > 0) {
      unsigned long hold = now - encDownTime;
      if (hold < 2000) { // Standard click logic
        if (thumbPressed) {
          thumbWasInteracted = true;
          contrastIdx = (contrastIdx + 1) % 8;
          camera.sendP6Adjust(0x02, (uint8_t)CONTRAST_STEPS[contrastIdx], false);
          Serial.print("Contrast "); Serial.println(CONTRAST_STEPS[contrastIdx]);
        } else if (now - lastBtnPressTime > 250) {
          palette = (palette + 1) % 6;
          camera.sendP6Palette((uint8_t)palette, false);
          Serial.print("Palette "); Serial.println(palette);
        }
      }
      encDownTime = 0;
      lastBtnPressTime = now;
    }
  }

  // -------- 3. THUMB BUTTON (NUC / AutoCal / OTA hotspot) --------
  if (thumbPressed) {
    if (thumbDownTime == 0 && (now - thumbActionCooldown > 150)) {
      thumbDownTime = now;
      thumbWasInteracted = false;
      b5s = false; b10s = false;
    }
    if (thumbDownTime > 0) {
      unsigned long held = now - thumbDownTime;
      if (held >= 10000 && !b10s) {
        digitalWrite(led, LED_ON); delay(100); digitalWrite(led, LED_OFF);
        delay(100); digitalWrite(led, LED_ON); delay(100); digitalWrite(led, LED_OFF);
        b10s = true;
      } else if (held >= 5000 && !b5s) {
        digitalWrite(led, LED_ON); delay(200); digitalWrite(led, LED_OFF);
        b5s = true;
      }
    }
  } else if (thumbDownTime > 0) {
    unsigned long holdTime = now - thumbDownTime;
    if (holdTime > 30 && !thumbWasInteracted) {
      if (holdTime >= 10000) {
        // Toggle the OTA Wi-Fi hotspot (replaces the sketch's raw WiFi/OTA).
        if (!ota.isActive()) {
          if (ota.beginWindow()) {
            Serial.println("Hotspot ON: OTA AP started");
          } else {
            Serial.println("Hotspot start failed");
          }
        } else {
          ota.requestStopWindow();
          Serial.println("Hotspot OFF: OTA AP stopping");
        }
      } else if (holdTime >= 5000) {
        autoCalEnabled = !autoCalEnabled;
        camera.sendP6Calibrate(0x01, autoCalEnabled ? 0x01 : 0x00, false);
        preferences.putBool("autocal", autoCalEnabled);
        Serial.print("AutoCal ");
        Serial.println(autoCalEnabled ? "on" : "off");
      } else if (holdTime < 500) {
        camera.sendP6Calibrate(0x02, 0, false); // Manual NUC
        Serial.println("Manual NUC");
      }
    }
    thumbDownTime = 0;
    thumbActionCooldown = now;
  }
}
