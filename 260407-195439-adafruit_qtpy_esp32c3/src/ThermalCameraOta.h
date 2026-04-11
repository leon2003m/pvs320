#ifndef THERMAL_CAMERA_OTA_H
#define THERMAL_CAMERA_OTA_H

#include <Arduino.h>

class ThermalCameraOta {
public:
  ThermalCameraOta(const char* ssid, const char* apPassword, const char* otaPassword, const char* hostname);

  bool beginWindow();
  bool requestBeginWindow();
  bool stopWindow();
  bool requestStopWindow();
  void update();
  bool isActive() const;
  bool isStartPending() const;
  unsigned long remainingMs() const;

private:
  static const unsigned long OTA_WINDOW_MS = 5UL * 60UL * 1000UL;

  const char* apSsid;
  const char* apPassword;
  const char* otaPassword;
  const char* otaHostname;
  unsigned long startedMs;
  unsigned long startRequestedMs;
  unsigned long stopRequestedMs;
  bool active;
  bool startRequested;
  bool stopRequested;

  bool activateWindow();
  void endWindow();
};

#endif
