#ifndef THERMAL_CAMERA_PROFILE_BUTTON_H
#define THERMAL_CAMERA_PROFILE_BUTTON_H

#include <Arduino.h>
#include "ThermalCameraProfiles.h"

class ThermalCameraProfileButton {
public:
  ThermalCameraProfileButton(uint8_t pin, ThermalCameraProfiles& profilesRef);

  void begin();
  void update();
  uint8_t currentProfile() const;

private:
  static const unsigned long DEBOUNCE_MS = 50;

  uint8_t buttonPin;
  ThermalCameraProfiles& profiles;
  bool lastReading;
  bool stableState;
  unsigned long lastChangeMs;

  void applyNextProfile();
};

#endif
