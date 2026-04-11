#ifndef THERMAL_CAMERA_PROFILES_H
#define THERMAL_CAMERA_PROFILES_H

#include <Arduino.h>
#include <Preferences.h>
#include "ThermalCameraSerial.h"

struct ThermalCameraProfile {
  uint8_t palette;
  uint8_t brightness;
  uint8_t contrast;
  uint8_t enhancement;
};

class ThermalCameraProfiles {
public:
  explicit ThermalCameraProfiles(ThermalCameraSerial& cameraRef);

  void begin();
  bool apply(uint8_t palette);
  bool set(uint8_t palette, uint8_t brightness, uint8_t contrast, uint8_t enhancement);
  bool get(uint8_t palette, ThermalCameraProfile& profile) const;
  uint8_t count() const;
  uint8_t activeProfile() const;
  void printProfiles() const;

private:
  static const uint8_t PROFILE_COUNT = 5;
  static const unsigned long COMMAND_DELAY_MS = 50;
  static const unsigned long COMMAND_RESPONSE_TIMEOUT_MS = 700;

  ThermalCameraSerial& camera;
  Preferences preferences;
  ThermalCameraProfile profiles[PROFILE_COUNT];
  uint8_t selectedProfile;

  bool isValidPalette(uint8_t palette) const;
  void loadProfile(uint8_t palette);
  void saveProfile(uint8_t palette);
  String keyFor(uint8_t palette, const char* suffix) const;
};

#endif
