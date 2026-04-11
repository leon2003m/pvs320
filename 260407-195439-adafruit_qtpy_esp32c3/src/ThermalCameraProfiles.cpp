#include "ThermalCameraProfiles.h"

ThermalCameraProfiles::ThermalCameraProfiles(ThermalCameraSerial& cameraRef)
  : camera(cameraRef),
    selectedProfile(0),
    profiles{
      {0, 120, 3, 3},
      {1, 140, 4, 4},
      {2, 160, 5, 5},
      {3, 100, 2, 2},
      {4, 180, 6, 6},
    } {
}

void ThermalCameraProfiles::begin() {
  if (!preferences.begin("tc_profiles", false)) {
    Serial.println("ERR: profile storage unavailable; using defaults");
    return;
  }

  for (uint8_t i = 0; i < PROFILE_COUNT; i++) {
    loadProfile(i);
  }

  Serial.println("Loaded profiles");
}

bool ThermalCameraProfiles::apply(uint8_t palette) {
  if (!isValidPalette(palette)) return false;

  const ThermalCameraProfile& profile = profiles[palette];
  camera.sendPalette(profile.palette);
  if (!camera.awaitResponse(COMMAND_RESPONSE_TIMEOUT_MS)) return false;
  delay(COMMAND_DELAY_MS);
  camera.sendBrightness(profile.brightness);
  if (!camera.awaitResponse(COMMAND_RESPONSE_TIMEOUT_MS)) return false;
  delay(COMMAND_DELAY_MS);
  camera.sendContrast(profile.contrast);
  if (!camera.awaitResponse(COMMAND_RESPONSE_TIMEOUT_MS)) return false;
  delay(COMMAND_DELAY_MS);
  camera.sendEnhancement(profile.enhancement);
  if (!camera.awaitResponse(COMMAND_RESPONSE_TIMEOUT_MS)) return false;

  selectedProfile = palette;

  Serial.print("Applied profile ");
  Serial.println(palette);
  return true;
}

bool ThermalCameraProfiles::set(
  uint8_t palette,
  uint8_t brightness,
  uint8_t contrast,
  uint8_t enhancement) {
  if (!isValidPalette(palette)) return false;

  profiles[palette] = {palette, brightness, contrast, enhancement};
  saveProfile(palette);
  Serial.print("Updated profile ");
  Serial.println(palette);
  return true;
}

bool ThermalCameraProfiles::get(uint8_t palette, ThermalCameraProfile& profile) const {
  if (!isValidPalette(palette)) return false;

  profile = profiles[palette];
  return true;
}

uint8_t ThermalCameraProfiles::count() const {
  return PROFILE_COUNT;
}

uint8_t ThermalCameraProfiles::activeProfile() const {
  return selectedProfile;
}

void ThermalCameraProfiles::printProfiles() const {
  Serial.println("Profiles:");
  Serial.println("  palette brightness contrast enhancement");

  for (uint8_t i = 0; i < PROFILE_COUNT; i++) {
    Serial.print("  ");
    Serial.print(profiles[i].palette);
    Serial.print("       ");
    Serial.print(profiles[i].brightness);
    Serial.print("          ");
    Serial.print(profiles[i].contrast);
    Serial.print("        ");
    Serial.println(profiles[i].enhancement);
  }
}

bool ThermalCameraProfiles::isValidPalette(uint8_t palette) const {
  return palette < PROFILE_COUNT;
}

void ThermalCameraProfiles::loadProfile(uint8_t palette) {
  if (!isValidPalette(palette)) return;

  profiles[palette].palette = palette;
  profiles[palette].brightness = preferences.getUChar(keyFor(palette, "b").c_str(), profiles[palette].brightness);
  profiles[palette].contrast = preferences.getUChar(keyFor(palette, "c").c_str(), profiles[palette].contrast);
  profiles[palette].enhancement = preferences.getUChar(keyFor(palette, "e").c_str(), profiles[palette].enhancement);
}

void ThermalCameraProfiles::saveProfile(uint8_t palette) {
  if (!isValidPalette(palette)) return;

  preferences.putUChar(keyFor(palette, "b").c_str(), profiles[palette].brightness);
  preferences.putUChar(keyFor(palette, "c").c_str(), profiles[palette].contrast);
  preferences.putUChar(keyFor(palette, "e").c_str(), profiles[palette].enhancement);
}

String ThermalCameraProfiles::keyFor(uint8_t palette, const char* suffix) const {
  String key = "p";
  key += palette;
  key += suffix;
  return key;
}
