#ifndef THERMAL_CAMERA_SERIAL_H
#define THERMAL_CAMERA_SERIAL_H

#include <Arduino.h>

class ThermalCameraSerial {
public:
  ThermalCameraSerial(HardwareSerial& serialRef, int txPin, int rxPin, uint32_t baud);

  void begin();
  void update();

  int getRxPin() const;

  void toggleDebugMode();
  bool getDebugMode() const;

  void sendInit(bool logToSerial = true);
  void sendFw(bool logToSerial = true);
  void sendModel(bool logToSerial = true);
  void sendBrightness(uint8_t value, bool logToSerial = true);
  void sendContrast(uint8_t value, bool logToSerial = true);
  void sendEnhancement(uint8_t value, bool logToSerial = true);
  void sendPalette(uint8_t value, bool logToSerial = true);
  void sendZoom(uint8_t value, bool logToSerial = true);
  void sendScreenAdjust(bool logToSerial = true);
  void sendManualAdjust(bool logToSerial = true);
  void sendAuto(bool on, bool logToSerial = true);

  String getFirmwareVersion() const;
  String getModelName() const;
  unsigned long getFirmwareUpdatedMs() const;
  unsigned long getModelUpdatedMs() const;
  uint8_t getCurrentBrightness() const;
  uint8_t getCurrentContrast() const;
  uint8_t getCurrentEnhancement() const;
  uint8_t getCurrentPalette() const;
  bool awaitResponse(unsigned long timeoutMs = 700);
  bool refreshIdentity(unsigned long timeoutMs = 500);
  bool queryFirmware(unsigned long timeoutMs = 500, uint8_t attempts = 1);
  bool queryModel(unsigned long timeoutMs = 500, uint8_t attempts = 2);

private:
  HardwareSerial& camSerial;
  String frameBuf;
  unsigned long lastFrameByteMs;
  unsigned long requestStartedMs;
  unsigned long firmwareUpdatedMs;
  unsigned long modelUpdatedMs;

  int currentRxPin;
  int cameraTxPin;
  uint32_t cameraBaud;
  bool debugMode;
  bool waitingForResponse;
  bool lastRequestSucceeded;
  int silentResponseCount;
  uint8_t currentBrightness;
  uint8_t currentContrast;
  uint8_t currentEnhancement;
  uint8_t currentPalette;
  String firmwareVersion;
  String modelName;

  void printHex(uint8_t b);
  void beginCam(int rxPin);
  void decodeFrame(const String& frame);
  void checkFrameTimeout();
  void markRequestSent(bool logToSerial);
  uint8_t checksumPayload(const uint8_t* payload, uint16_t payloadLen) const;
  void sendCommand(uint8_t op, uint8_t cmd, const uint8_t* payload, uint16_t payloadLen, bool logToSerial);
};

#endif
