#define ARDUINO_USB_CDC_ON_BOOT 1
#include <Arduino.h>
#include "ThermalCameraSerial.h"
#include "ThermalCameraProfiles.h"
#include "ThermalCameraProfileButton.h"
#include "ThermalCameraBleServer.h"
#include "ThermalCameraOta.h"

#define USB_BAUD 115200
#define CAMERA_BAUD 500000
#define CAMERA_TX_PIN 21
#define CAMERA_RX_PIN 20
#define PROFILE_BUTTON_PIN 10
#define BLE_DEVICE_NAME "ThermalCamera"
#define OTA_AP_SSID "ThermalCameraOTA"
#define OTA_AP_PASSWORD "changeme"
#define OTA_PASSWORD "changeme"
#define OTA_HOSTNAME "thermal-camera"
#define ENABLE_BLE 1
#define ENABLE_OTA 1
#define ENABLE_PROFILES 1
#define ENABLE_PROFILE_BUTTON 1

HardwareSerial CAM_SERIAL(1);
ThermalCameraSerial camera(CAM_SERIAL, CAMERA_TX_PIN, CAMERA_RX_PIN, CAMERA_BAUD);
ThermalCameraProfiles profiles(camera);
ThermalCameraProfileButton profileButton(PROFILE_BUTTON_PIN, profiles);
ThermalCameraOta otaUpdater(OTA_AP_SSID, OTA_AP_PASSWORD, OTA_PASSWORD, OTA_HOSTNAME);
ThermalCameraBleServer* bleServer = nullptr;

String inputLine;

bool parseValue(String text, uint8_t minValue, uint8_t maxValue, uint8_t& value) {
  text.trim();
  if (!text.length()) return false;

  for (size_t i = 0; i < text.length(); i++) {
    if (!isDigit(text[i])) return false;
  }

  int parsed = text.toInt();
  if (parsed < minValue || parsed > maxValue) return false;

  value = (uint8_t)parsed;
  return true;
}

bool parseProfileSet(String text, uint8_t& palette, uint8_t& brightness, uint8_t& contrast, uint8_t& enhancement) {
  text.trim();

  int firstSpace = text.indexOf(' ');
  int secondSpace = text.indexOf(' ', firstSpace + 1);
  int thirdSpace = text.indexOf(' ', secondSpace + 1);

  if (firstSpace < 0 || secondSpace < 0 || thirdSpace < 0) return false;
  if (text.indexOf(' ', thirdSpace + 1) >= 0) return false;

  return parseValue(text.substring(0, firstSpace), 0, 4, palette) &&
         parseValue(text.substring(firstSpace + 1, secondSpace), 0, 255, brightness) &&
         parseValue(text.substring(secondSpace + 1, thirdSpace), 0, 7, contrast) &&
         parseValue(text.substring(thirdSpace + 1), 0, 7, enhancement);
}

void printHelp() {
  Serial.println();
  Serial.println("Commands:");
  Serial.println("  init                 -> send init");
  Serial.println("  fw                   -> send firmware query");
  Serial.println("  model                -> send model query");
  Serial.println("  brightness <0-255>   -> set brightness");
  Serial.println("  contrast <0-7>       -> set contrast");
  Serial.println("  enhancement <0-7>    -> set enhancement/sharpening");
  Serial.println("  palette <0-4>        -> set palette");
  Serial.println("  profile <0-4>        -> apply palette profile");
  Serial.println("  profile_get <0-4>    -> show palette profile over BLE status");
  Serial.println("  profile_set <p> <b> <c> <e>");
  Serial.println("  profile_show         -> show palette profiles");
  Serial.println("  zoom <1-8>           -> set zoom");
  Serial.println("  sceen_adjust         -> send command 0x06");
  Serial.println("  manual_adjust        -> send command 0x05");
  Serial.println("  auto <on|off>        -> set auto mode");
  Serial.println("  set_cam_pins <tx> <rx> -> set camera UART TX/RX pins and restart UART");
  Serial.println("  camera_pins          -> show current camera UART pins");
  Serial.println("  ota_start            -> start WiFi OTA for 5 minutes");
  Serial.println("  ota_stop             -> stop WiFi OTA immediately");
  Serial.println("  ble_password <pw>    -> set BLE command password");
  Serial.println("  ble_name <name>      -> set BLE advertised name");
  Serial.println("  debug                -> toggle debug byte dump");
  Serial.println("  help");
  Serial.println();
}

void handleCommand(String line) {
  line.trim();
  if (!line.length()) return;

  if (line == "help") {
    printHelp();
    return;
  }

  if (line == "init") {
    camera.sendInit();
    return;
  }

  if (line == "fw") {
    if (!camera.queryFirmware()) {
      Serial.println(camera.getFirmwareVersion());
    }
    return;
  }

  if (line == "model") {
    if (!camera.queryModel()) {
      Serial.println(camera.getModelName());
    }
    return;
  }

  if (line == "debug") {
    camera.toggleDebugMode();
    return;
  }

  if (line.startsWith("ble_password ")) {
#if ENABLE_BLE
    if (!bleServer) {
      Serial.println("BLE is not initialized.");
      return;
    }
    String newPassword = line.substring(13);
    if (!bleServer->setPassword(newPassword)) {
      Serial.println("Invalid BLE password. Use 4-32 characters, no spaces.");
      return;
    }
    Serial.println("BLE password updated. Existing BLE sessions must authenticate again.");
#else
    Serial.println("BLE is disabled in this build.");
#endif
    return;
  }

  if (line.startsWith("ble_name ")) {
#if ENABLE_BLE
    if (!bleServer) {
      Serial.println("BLE is not initialized.");
      return;
    }
    String newName = line.substring(9);
    if (!bleServer->setDeviceName(newName)) {
      Serial.println("Invalid BLE name. Use 1-20 printable characters.");
      return;
    }
    Serial.print("BLE name updated: ");
    Serial.println(bleServer->getDeviceName());
#else
    Serial.println("BLE is disabled in this build.");
#endif
    return;
  }

  if (line == "ota_start") {
#if ENABLE_OTA
    if (!otaUpdater.beginWindow()) {
      Serial.println("ERR: OTA start failed");
      return;
    }
    Serial.println("OTA started. Connect to WiFi ThermalCameraOTA for upload.");
#else
    Serial.println("OTA is disabled in this build.");
#endif
    return;
  }

  if (line == "ota_stop") {
#if ENABLE_OTA
    if (!otaUpdater.requestStopWindow()) {
      Serial.println("ERR: OTA not active");
      return;
    }
    Serial.println("OTA stopping. WiFi AP will disable shortly.");
#else
    Serial.println("OTA is disabled in this build.");
#endif
    return;
  }

  if (line.startsWith("brightness ")) {
    uint8_t value;
    if (!parseValue(line.substring(11), 0, 255, value)) {
      Serial.println("Invalid brightness. Use: brightness <0-255>");
      return;
    }
    camera.sendBrightness(value);
    return;
  }

  if (line.startsWith("contrast ")) {
    uint8_t value;
    if (!parseValue(line.substring(9), 0, 7, value)) {
      Serial.println("Invalid contrast. Use: contrast <0-7>");
      return;
    }
    camera.sendContrast(value);
    return;
  }

  if (line.startsWith("enhancement ")) {
    uint8_t value;
    if (!parseValue(line.substring(12), 0, 7, value)) {
      Serial.println("Invalid enhancement. Use: enhancement <0-7>");
      return;
    }
    camera.sendEnhancement(value);
    return;
  }

  if (line.startsWith("palette ")) {
    uint8_t value;
    if (!parseValue(line.substring(8), 0, 4, value)) {
      Serial.println("Invalid palette. Use: palette <0-4>");
      return;
    }
    camera.sendPalette(value);
    return;
  }

  if (line.startsWith("profile_set ")) {
#if ENABLE_PROFILES
    uint8_t palette;
    uint8_t brightness;
    uint8_t contrast;
    uint8_t enhancement;
    if (!parseProfileSet(line.substring(12), palette, brightness, contrast, enhancement)) {
      Serial.println("Invalid profile_set. Use: profile_set <0-4> <0-255> <0-7> <0-7>");
      return;
    }
    profiles.set(palette, brightness, contrast, enhancement);
#else
    Serial.println("Profiles are disabled in this build.");
#endif
    return;
  }

  if (line.startsWith("profile ")) {
#if ENABLE_PROFILES
    uint8_t value;
    if (!parseValue(line.substring(8), 0, 4, value)) {
      Serial.println("Invalid profile. Use: profile <0-4>");
      return;
    }
    profiles.apply(value);
#else
    Serial.println("Profiles are disabled in this build.");
#endif
    return;
  }

  if (line == "profile_show") {
#if ENABLE_PROFILES
    profiles.printProfiles();
#else
    Serial.println("Profiles are disabled in this build.");
#endif
    return;
  }

  if (line.startsWith("zoom ")) {
    uint8_t value;
    if (!parseValue(line.substring(5), 1, 8, value)) {
      Serial.println("Invalid zoom. Use: zoom <1-8>");
      return;
    }
    camera.sendZoom(value);
    return;
  }

  if (line == "sceen_adjust") {
    camera.sendScreenAdjust();
    return;
  }

  if (line == "manual_adjust") {
    camera.sendManualAdjust();
    return;
  }

  if (line == "auto on") {
    camera.sendAuto(true);
    return;
  }

  if (line == "auto off") {
    camera.sendAuto(false);
    return;
  }

  if (line.startsWith("auto ")) {
    Serial.println("Invalid auto mode. Use: auto <on|off>");
    return;
  }

  if (line == "camera_pins") {
    Serial.print("Camera UART pins: TX=");
    Serial.print(camera.getTxPin());
    Serial.print(" RX=");
    Serial.println(camera.getRxPin());
    return;
  }

  if (line.startsWith("set_cam_pins ")) {
    int spaceIndex = line.indexOf(' ', 12);
    if (spaceIndex < 0) {
      Serial.println("Invalid set_cam_pins. Use: set_cam_pins <tx> <rx>");
      return;
    }

    uint8_t txPin;
    uint8_t rxPin;
    if (!parseValue(line.substring(12, spaceIndex), 0, 39, txPin) ||
        !parseValue(line.substring(spaceIndex + 1), 0, 39, rxPin)) {
      Serial.println("Invalid set_cam_pins. Use: set_cam_pins <tx> <rx>");
      return;
    }

    camera.setCameraPins(txPin, rxPin);
    return;
  }

  Serial.println("Unknown command. Type 'help' for available commands.");
}

void setup() {
  Serial.begin(USB_BAUD);
  delay(2000);

  camera.begin();
  delay(500);
  camera.begin();
#if ENABLE_PROFILES
  profiles.begin();
#endif
#if ENABLE_PROFILE_BUTTON
  profileButton.begin();
#endif
#if ENABLE_BLE
  bleServer = new ThermalCameraBleServer(camera, profiles, otaUpdater, BLE_DEVICE_NAME);
  bleServer->begin();
#endif

  Serial.println("Manual UART tester ready");
  printHelp();
}

void loop() {
  while (Serial.available()) {
    char c = (char)Serial.read();

    if (c == '\r') continue;

    if (c == '\n') {
      handleCommand(inputLine);
      inputLine = "";
    } else {
      inputLine += c;
    }
  }
  camera.update();
#if ENABLE_PROFILE_BUTTON
  profileButton.update();
#endif
#if ENABLE_BLE
  if (bleServer) bleServer->update();
#endif
#if ENABLE_OTA
  otaUpdater.update();
#endif
}
