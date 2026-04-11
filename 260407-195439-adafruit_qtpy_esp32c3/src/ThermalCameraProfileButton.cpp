#include "ThermalCameraProfileButton.h"

ThermalCameraProfileButton::ThermalCameraProfileButton(uint8_t pin, ThermalCameraProfiles& profilesRef)
  : buttonPin(pin),
    profiles(profilesRef),
    lastReading(HIGH),
    stableState(HIGH),
    lastChangeMs(0) {
}

void ThermalCameraProfileButton::begin() {
  pinMode(buttonPin, INPUT_PULLUP);
  lastReading = digitalRead(buttonPin);
  stableState = lastReading;

  Serial.print("Profile button pin: ");
  Serial.println(buttonPin);
}

void ThermalCameraProfileButton::update() {
  bool reading = digitalRead(buttonPin);

  if (reading != lastReading) {
    lastChangeMs = millis();
    lastReading = reading;
  }

  if (millis() - lastChangeMs < DEBOUNCE_MS) return;
  if (reading == stableState) return;

  stableState = reading;
  if (stableState == LOW) {
    applyNextProfile();
  }
}

uint8_t ThermalCameraProfileButton::currentProfile() const {
  return profiles.activeProfile();
}

void ThermalCameraProfileButton::applyNextProfile() {
  uint8_t profileCount = profiles.count();
  if (!profileCount) return;

  uint8_t nextProfile = (uint8_t)((profiles.activeProfile() + 1) % profileCount);
  if (!profiles.apply(nextProfile)) {
    Serial.println("ERR: profile button apply failed");
    return;
  }

  Serial.print("Button profile: ");
  Serial.println(nextProfile);
}
