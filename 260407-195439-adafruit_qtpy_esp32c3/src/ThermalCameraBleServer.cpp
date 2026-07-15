#include "ThermalCameraBleServer.h"

static const char* SERVICE_UUID = "b7d10000-6f2d-4f9a-9c11-2f43a0000001";
static const char* LEGACY_STATUS_UUID = "b7d10001-6f2d-4f9a-9c11-2f43a0000001";
static const char* LEGACY_COMMAND_UUID = "b7d10002-6f2d-4f9a-9c11-2f43a0000001";
static const char* PROTOCOL_UUID = "b7d10003-6f2d-4f9a-9c11-2f43a0000001";
static const char* RPC_UUID = "b7d10004-6f2d-4f9a-9c11-2f43a0000001";
static const char* STATE_UUID = "b7d10005-6f2d-4f9a-9c11-2f43a0000001";
static const char* LOG_UUID = "b7d10006-6f2d-4f9a-9c11-2f43a0000001";
static const char* DEFAULT_PASSWORD = "changeme";
static const uint8_t PROTOCOL_VERSION = 2;
static const unsigned long OTA_STATE_NOTIFY_INTERVAL_MS = 1000;
static const unsigned long BLE_RESET_GRACE_MS = 200;
static const unsigned long IDENTITY_REFRESH_RETRY_MS = 1200;
static const size_t BLE_JSON_CHUNK_SIZE = 20;

namespace {
BleCommandResult okResult(const String& message) {
  return {true, nullptr, message};
}

BleCommandResult errorResult(const char* code, const String& message) {
  return {false, code, message};
}

bool parseJsonUint8(JsonVariantConst value, uint8_t minValue, uint8_t maxValue, uint8_t& out) {
  if (value.is<uint8_t>()) {
    uint8_t parsed = value.as<uint8_t>();
    if (parsed < minValue || parsed > maxValue) return false;
    out = parsed;
    return true;
  }

  if (value.is<int>()) {
    int parsed = value.as<int>();
    if (parsed < minValue || parsed > maxValue) return false;
    out = (uint8_t)parsed;
    return true;
  }

  if (value.is<const char*>()) {
    const char* text = value.as<const char*>();
    if (!text || !strlen(text)) return false;
    for (size_t i = 0; text[i]; i++) {
      if (!isDigit(text[i])) return false;
    }
    int parsed = atoi(text);
    if (parsed < minValue || parsed > maxValue) return false;
    out = (uint8_t)parsed;
    return true;
  }

  return false;
}

bool parseJsonBool(JsonVariantConst value, bool& out) {
  if (value.is<bool>()) {
    out = value.as<bool>();
    return true;
  }

  if (value.is<const char*>()) {
    String text = value.as<const char*>();
    text.toLowerCase();
    if (text == "true" || text == "1" || text == "on") {
      out = true;
      return true;
    }
    if (text == "false" || text == "0" || text == "off") {
      out = false;
      return true;
    }
  }

  return false;
}
}  // namespace

ThermalCameraBleCallbacks::ThermalCameraBleCallbacks(ThermalCameraBleServer& bleServerRef)
  : bleServer(bleServerRef) {
}

void ThermalCameraBleCallbacks::onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) {
  (void)server;
  (void)connInfo;
  bleServer.setConnected(true);
}

void ThermalCameraBleCallbacks::onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) {
  (void)server;
  (void)connInfo;
  (void)reason;
  bleServer.setConnected(false);
}

ThermalCameraBleCommandCallbacks::ThermalCameraBleCommandCallbacks(ThermalCameraBleServer& bleServerRef)
  : bleServer(bleServerRef) {
}

void ThermalCameraBleCommandCallbacks::onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo) {
  (void)connInfo;
  std::string value = characteristic->getValue();
  if (value.empty()) return;

  bleServer.handleCommand(String(value.c_str()));
}

ThermalCameraBleRpcCallbacks::ThermalCameraBleRpcCallbacks(ThermalCameraBleServer& bleServerRef)
  : bleServer(bleServerRef) {
}

void ThermalCameraBleRpcCallbacks::onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo) {
  (void)connInfo;
  std::string value = characteristic->getValue();
  if (value.empty()) return;

  bleServer.handleRpcPayload(String(value.c_str()));
}

ThermalCameraBleServer::ThermalCameraBleServer(
  ThermalCameraSerial& cameraRef,
  ThermalCameraProfiles& profilesRef,
  ThermalCameraOta& otaRef,
  const char* deviceName)
  : camera(cameraRef),
    profiles(profilesRef),
    ota(otaRef),
    bleDeviceName(deviceName),
    server(nullptr),
    legacyStatusCharacteristic(nullptr),
    protocolCharacteristic(nullptr),
    rpcCharacteristic(nullptr),
    stateCharacteristic(nullptr),
    logCharacteristic(nullptr),
    connected(false),
    advertising(false),
    authenticated(false),
    lastStatusMs(0),
    lastPublishedOtaActive(false),
    pendingBleReset(false),
    pendingBleResetAtMs(0),
    pendingIdentityRefresh(false),
    pendingIdentityRefreshAtMs(0),
    lastResponse("locked"),
    authStatus("required"),
    password(DEFAULT_PASSWORD),
    deviceName(deviceName),
    stateSequence(0),
    lastErrorCode(""),
    lastErrorMessage("") {
}

void ThermalCameraBleServer::begin() {
  loadPassword();
  loadDeviceName();

  NimBLEDevice::init(deviceName.c_str());
  NimBLEDevice::setSecurityAuth(false, false, false);

  server = NimBLEDevice::createServer();
  server->setCallbacks(new ThermalCameraBleCallbacks(*this));

  NimBLEService* service = server->createService(SERVICE_UUID);

  legacyStatusCharacteristic = service->createCharacteristic(
    LEGACY_STATUS_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  NimBLECharacteristic* legacyCommandCharacteristic = service->createCharacteristic(
    LEGACY_COMMAND_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  legacyCommandCharacteristic->setCallbacks(new ThermalCameraBleCommandCallbacks(*this));

  protocolCharacteristic = service->createCharacteristic(
    PROTOCOL_UUID,
    NIMBLE_PROPERTY::READ);

  rpcCharacteristic = service->createCharacteristic(
    RPC_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::NOTIFY);
  rpcCharacteristic->setCallbacks(new ThermalCameraBleRpcCallbacks(*this));

  stateCharacteristic = service->createCharacteristic(
    STATE_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  logCharacteristic = service->createCharacteristic(
    LOG_UUID,
    NIMBLE_PROPERTY::NOTIFY);

  service->start();

  NimBLEAdvertising* bleAdvertising = NimBLEDevice::getAdvertising();
  configureAdvertising(bleAdvertising);
  restartAdvertising();

  publishProtocolMetadata();
  publishLegacyStatus(false);
  publishStateEvent(false);

  Serial.print("BLE name: ");
  Serial.println(deviceName);
  Serial.print("BLE service UUID: ");
  Serial.println(SERVICE_UUID);
  Serial.print("BLE protocol UUID: ");
  Serial.println(PROTOCOL_UUID);
  Serial.print("BLE rpc UUID: ");
  Serial.println(RPC_UUID);
  Serial.print("BLE state UUID: ");
  Serial.println(STATE_UUID);
  Serial.println("BLE password required. App command: password <password>");
}

void ThermalCameraBleServer::update() {
  if (pendingBleReset && millis() >= pendingBleResetAtMs) {
    pendingBleReset = false;
    resetBleSessions();
  }

  if (pendingIdentityRefresh && authenticated && millis() >= pendingIdentityRefreshAtMs) {
    pendingIdentityRefresh = false;
    BleCommandResult identityResult = refreshIdentityState("Device identity refreshed");
    if (identityResult.ok) {
      lastResponse = identityResult.message;
      lastErrorCode = "";
      lastErrorMessage = "";
    }
    publishLegacyStatus(true);
    publishStateEvent(true);
  }

  if (!advertising && !connected) {
    restartAdvertising();
  }

  const bool otaActive = ota.isActive();
  if (connected && otaActive != lastPublishedOtaActive) {
    publishLegacyStatus(true);
    publishStateEvent(true);
  }

  if (connected && otaActive && millis() - lastStatusMs >= OTA_STATE_NOTIFY_INTERVAL_MS) {
    publishLegacyStatus(true);
    publishStateEvent(true);
  }
}

void ThermalCameraBleServer::setConnected(bool isConnected) {
  connected = isConnected;
  advertising = false;
  authenticated = false;
  authStatus = connected ? "required" : "disconnected";
  lastResponse = connected ? "locked" : "disconnected";
  lastErrorCode = "";
  lastErrorMessage = "";
  lastPublishedOtaActive = ota.isActive();

  Serial.print("BLE client ");
  Serial.println(connected ? "connected" : "disconnected");
  publishProtocolMetadata();
  publishLegacyStatus(true);
  publishStateEvent(true);
}

void ThermalCameraBleServer::populateStateJson(JsonObject state, const ThermalCameraProfile* overrideProfile, int overrideIndex) const {
  uint8_t paletteValue = camera.getCurrentPalette();
  uint8_t brightnessValue = camera.getCurrentBrightness();
  uint8_t contrastValue = camera.getCurrentContrast();
  uint8_t enhancementValue = camera.getCurrentEnhancement();

  if (overrideProfile) {
    paletteValue = overrideProfile->palette;
    brightnessValue = overrideProfile->brightness;
    contrastValue = overrideProfile->contrast;
    enhancementValue = overrideProfile->enhancement;
  }

  state["bleName"] = deviceName;
  state["palette"] = paletteValue;
  state["brightness"] = brightnessValue;
  state["contrast"] = contrastValue;
  state["enhancement"] = enhancementValue;
  state["activeProfile"] = overrideIndex >= 0 ? overrideIndex : profiles.activeProfile();
  state["model"] = camera.getModelName();
  state["firmware"] = camera.getFirmwareVersion();

  if (camera.getModelUpdatedMs()) {
    state["modelAgeMs"] = millis() - camera.getModelUpdatedMs();
  } else {
    state["modelAgeMs"] = nullptr;
  }

  if (camera.getFirmwareUpdatedMs()) {
    state["firmwareAgeMs"] = millis() - camera.getFirmwareUpdatedMs();
  } else {
    state["firmwareAgeMs"] = nullptr;
  }

  state["authenticated"] = authenticated;
  state["authStatus"] = authStatus;
  state["otaActive"] = ota.isActive();
  state["otaRemainingMs"] = ota.remainingMs();
  state["lastResponse"] = lastResponse;
  state["lastErrorCode"] = lastErrorCode;
  state["lastErrorMessage"] = lastErrorMessage;
}

void ThermalCameraBleServer::populateProfileJson(JsonObject profileJson, const ThermalCameraProfile& profile, uint8_t profileIndex) const {
  profileJson["profile"] = profileIndex;
  profileJson["palette"] = profile.palette;
  profileJson["brightness"] = profile.brightness;
  profileJson["contrast"] = profile.contrast;
  profileJson["enhancement"] = profile.enhancement;
}

String ThermalCameraBleServer::buildStateObjectJson(const ThermalCameraProfile* overrideProfile, int overrideIndex) const {
  JsonDocument doc;
  JsonObject state = doc.to<JsonObject>();
  populateStateJson(state, overrideProfile, overrideIndex);

  String json;
  serializeJson(doc, json);
  return json;
}

String ThermalCameraBleServer::buildStateJson() const {
  return buildStateObjectJson(nullptr, -1);
}

String ThermalCameraBleServer::buildStateEnvelopeJson() const {
  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;
  doc["type"] = "event";
  doc["event"] = "state";
  doc["seq"] = stateSequence;
  JsonObject state = doc["state"].to<JsonObject>();
  populateStateJson(state, nullptr, -1);

  String json;
  serializeJson(doc, json);
  return json;
}

String ThermalCameraBleServer::buildLegacyStatusJson() const {
  return buildLegacyStatusJson(nullptr, -1);
}

String ThermalCameraBleServer::buildLegacyStatusJson(const ThermalCameraProfile* overrideProfile, int overrideIndex) const {
  String json = "{";
  json += "\"bleName\":\"";
  json += jsonEscape(deviceName);
  json += "\",";
  json += "\"palette\":";
  json += String(overrideProfile ? overrideProfile->palette : camera.getCurrentPalette());
  json += ",\"brightness\":";
  json += String(overrideProfile ? overrideProfile->brightness : camera.getCurrentBrightness());
  json += ",\"contrast\":";
  json += String(overrideProfile ? overrideProfile->contrast : camera.getCurrentContrast());
  json += ",\"enhancement\":";
  json += String(overrideProfile ? overrideProfile->enhancement : camera.getCurrentEnhancement());
  json += ",\"activeProfile\":";
  json += String(overrideIndex >= 0 ? overrideIndex : profiles.activeProfile());
  json += ",\"model\":\"";
  json += jsonEscape(camera.getModelName());
  json += "\",\"firmware\":\"";
  json += jsonEscape(camera.getFirmwareVersion());
  json += "\",\"modelAgeMs\":";
  json += jsonAge(camera.getModelUpdatedMs());
  json += ",\"firmwareAgeMs\":";
  json += jsonAge(camera.getFirmwareUpdatedMs());
  json += ",\"authenticated\":";
  json += (authenticated ? "true" : "false");
  json += ",\"authStatus\":\"";
  json += jsonEscape(authStatus);
  json += "\",\"otaActive\":";
  json += (ota.isActive() ? "true" : "false");
  json += ",\"otaRemainingMs\":";
  json += String(ota.remainingMs());
  json += ",\"last\":\"";
  json += jsonEscape(lastResponse);
  json += "\"}";
  return json;
}

void ThermalCameraBleServer::appendCapabilities(JsonArray operations) const {
  operations.add("auth.login");
  operations.add("device.getCapabilities");
  operations.add("device.setPassword");
  operations.add("device.refreshIdentity");
  operations.add("profile.get");
  operations.add("profile.apply");
  operations.add("profile.save");
  operations.add("image.setBrightness");
  operations.add("image.setContrast");
  operations.add("image.setEnhancement");
  operations.add("image.setPalette");
  operations.add("image.setZoom");
  operations.add("calibration.manual");
  operations.add("calibration.screenAdjust");
  operations.add("calibration.setAuto");
  operations.add("calibration.dpc");
  operations.add("calibration.saveToCamera");
  operations.add("device.setBleName");
  operations.add("ota.start");
  operations.add("ota.stop");
}

String ThermalCameraBleServer::buildProtocolJson() const {
  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;

  String json;
  serializeJson(doc, json);
  return json;
}

String ThermalCameraBleServer::jsonEscape(const String& value) const {
  String escaped;
  escaped.reserve(value.length() + 8);

  for (size_t i = 0; i < value.length(); i++) {
    char c = value[i];
    if (c == '"' || c == '\\') {
      escaped += '\\';
      escaped += c;
    } else if (c == '\n') {
      escaped += "\\n";
    } else if (c == '\r') {
      escaped += "\\r";
    } else if (c == '\t') {
      escaped += "\\t";
    } else if ((uint8_t)c >= 32) {
      escaped += c;
    }
  }

  return escaped;
}

String ThermalCameraBleServer::jsonAge(unsigned long updatedMs) const {
  if (!updatedMs) return "null";
  return String(millis() - updatedMs);
}

void ThermalCameraBleServer::publishLegacyStatus(bool forceNotify) {
  if (!legacyStatusCharacteristic) return;

  lastStatusMs = millis();
  String status = buildLegacyStatusJson();
  legacyStatusCharacteristic->setValue(status.c_str());

  if ((connected || forceNotify) && server && server->getConnectedCount() > 0) {
    legacyStatusCharacteristic->notify();
  }
}

void ThermalCameraBleServer::publishLegacyResponse(const String& response) {
  lastResponse = response;
  lastErrorCode = "";
  lastErrorMessage = "";
  Serial.print("BLE command: ");
  Serial.println(response);
  publishLegacyStatus(true);
}

void ThermalCameraBleServer::publishProtocolMetadata() {
  if (!protocolCharacteristic) return;

  String metadata = buildProtocolJson();
  protocolCharacteristic->setValue(metadata.c_str());
}

void ThermalCameraBleServer::publishStateEvent(bool forceNotify) {
  if (!stateCharacteristic) return;

  lastStatusMs = millis();
  lastPublishedOtaActive = ota.isActive();
  stateSequence++;
  String stateJson = buildStateEnvelopeJson();
  stateCharacteristic->setValue(stateJson.c_str());

  if ((connected || forceNotify) && server && server->getConnectedCount() > 0) {
    notifyJsonChunks(stateCharacteristic, stateJson);
  }
}

void ThermalCameraBleServer::publishStateEventForProfile(uint8_t profileIndex, bool forceNotify) {
  if (!stateCharacteristic) return;

  ThermalCameraProfile profile;
  if (!profiles.get(profileIndex, profile)) {
    publishStateEvent(forceNotify);
    return;
  }

  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;
  doc["type"] = "event";
  doc["event"] = "state";
  doc["seq"] = stateSequence + 1;
  JsonObject state = doc["state"].to<JsonObject>();
  populateStateJson(state, &profile, profileIndex);

  String json;
  serializeJson(doc, json);

  lastStatusMs = millis();
  lastPublishedOtaActive = ota.isActive();
  stateSequence++;
  stateCharacteristic->setValue(json.c_str());
  if ((connected || forceNotify) && server && server->getConnectedCount() > 0) {
    notifyJsonChunks(stateCharacteristic, json);
  }
}

void ThermalCameraBleServer::publishRpcResponse(const JsonDocument& responseDoc) {
  if (!rpcCharacteristic) return;

  String json;
  serializeJson(responseDoc, json);
  rpcCharacteristic->setValue(json.c_str());
  if (server && server->getConnectedCount() > 0) {
    notifyJsonChunks(rpcCharacteristic, json);
  }
}

void ThermalCameraBleServer::publishRpcError(const String& id, const char* code, const String& message) {
  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;

  if (id.length()) {
    doc["type"] = "response";
    doc["id"] = id;
    doc["ok"] = false;
    doc["code"] = code;
    doc["message"] = message;
  } else {
    doc["type"] = "event";
    doc["event"] = "error";
    doc["code"] = code;
    doc["message"] = message;
  }

  lastErrorCode = code;
  lastErrorMessage = message;
  lastResponse = message;
  publishRpcResponse(doc);
  publishRpcLog(message);
  publishLegacyStatus(true);
  publishStateEvent(true);
}

void ThermalCameraBleServer::publishRpcLog(const String& message) {
  if (!logCharacteristic || !server || server->getConnectedCount() <= 0) return;

  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;
  doc["type"] = "event";
  doc["event"] = "log";
  doc["message"] = message;

  String json;
  serializeJson(doc, json);
  logCharacteristic->setValue(json.c_str());
  notifyJsonChunks(logCharacteristic, json);
}

bool ThermalCameraBleServer::notifyJsonChunks(NimBLECharacteristic* characteristic, const String& payload) {
  if (!characteristic) return false;

  if (payload.length() <= BLE_JSON_CHUNK_SIZE) {
    return characteristic->notify((const uint8_t*)payload.c_str(), payload.length());
  }

  bool sentAny = false;
  for (size_t offset = 0; offset < payload.length(); offset += BLE_JSON_CHUNK_SIZE) {
    String chunk = payload.substring(offset, offset + BLE_JSON_CHUNK_SIZE);
    if (!characteristic->notify((const uint8_t*)chunk.c_str(), chunk.length())) {
      return sentAny;
    }
    sentAny = true;
    delay(5);
  }

  return sentAny;
}

bool ThermalCameraBleServer::authenticateLegacy(String command) {
  if (!command.startsWith("password ")) return false;

  String candidate = command.substring(9);
  candidate.trim();
  if (candidate != password) {
    authenticated = false;
    authStatus = "denied";
    lastErrorCode = "auth_failed";
    lastErrorMessage = "Wrong password";
    publishLegacyResponse("ERR wrong password");
    publishStateEvent(true);
    return true;
  }

  authenticated = true;
  authStatus = "confirmed";
  lastErrorCode = "";
  lastErrorMessage = "";
  camera.refreshIdentity();
  publishLegacyResponse("OK authenticated");
  publishStateEvent(true);
  return true;
}

bool ThermalCameraBleServer::setPassword(String newPassword) {
  newPassword.trim();
  if (!isValidPassword(newPassword)) return false;

  password = newPassword;
  savePassword();
  authenticated = false;
  authStatus = "required";
  lastResponse = "locked";
  lastErrorCode = "";
  lastErrorMessage = "";
  if (connected) {
    queueBleReset();
  } else {
    resetBleSessions();
  }
  publishLegacyStatus(true);
  publishStateEvent(true);
  return true;
}

bool ThermalCameraBleServer::setDeviceName(String newName) {
  newName.trim();
  if (!isValidDeviceName(newName)) return false;

  deviceName = newName;
  saveDeviceName();

  NimBLEDevice::setDeviceName(deviceName.c_str());
  NimBLEAdvertising* bleAdvertising = NimBLEDevice::getAdvertising();
  if (bleAdvertising) {
    configureAdvertising(bleAdvertising);
    if (!connected) {
      restartAdvertising();
    }
  }

  publishProtocolMetadata();
  lastResponse = connected ? "BLE name updated; reconnect to continue" : "OK set_ble_name";
  lastErrorCode = "";
  lastErrorMessage = "";
  publishLegacyStatus(true);
  publishStateEvent(true);
  if (connected) {
    queueBleReset();
  }
  return true;
}

String ThermalCameraBleServer::getDeviceName() const {
  return deviceName;
}

bool ThermalCameraBleServer::isValidPassword(String newPassword) const {
  newPassword.trim();
  if (newPassword.length() < 4 || newPassword.length() > 32) return false;
  return newPassword.indexOf(' ') < 0;
}

bool ThermalCameraBleServer::isValidDeviceName(String newName) const {
  newName.trim();
  if (newName.length() < 1 || newName.length() > 20) return false;

  for (size_t i = 0; i < newName.length(); i++) {
    char c = newName[i];
    if ((uint8_t)c < 32 || (uint8_t)c > 126) return false;
  }

  return true;
}

void ThermalCameraBleServer::loadPassword() {
  if (!preferences.begin("tc_ble", false)) {
    Serial.println("ERR: BLE password storage unavailable; using default");
    password = DEFAULT_PASSWORD;
    return;
  }

  password = preferences.getString("password", DEFAULT_PASSWORD);
  if (!isValidPassword(password)) {
    password = DEFAULT_PASSWORD;
    savePassword();
  }
}

void ThermalCameraBleServer::savePassword() {
  preferences.putString("password", password);
}

void ThermalCameraBleServer::loadDeviceName() {
  deviceName = preferences.getString("name", bleDeviceName);
  if (!isValidDeviceName(deviceName)) {
    deviceName = bleDeviceName;
    saveDeviceName();
  }
}

void ThermalCameraBleServer::saveDeviceName() {
  preferences.putString("name", deviceName);
}

bool ThermalCameraBleServer::parseValue(String text, uint8_t minValue, uint8_t maxValue, uint8_t& value) const {
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

bool ThermalCameraBleServer::parseProfileSet(
  String text,
  uint8_t& palette,
  uint8_t& brightness,
  uint8_t& contrast,
  uint8_t& enhancement) const {
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

bool ThermalCameraBleServer::parseProfileIndex(String text, uint8_t& palette) const {
  return parseValue(text, 0, 4, palette);
}

BleCommandResult ThermalCameraBleServer::awaitCameraCommand(const String& successMessage) {
  // P6 commands are fire-and-forget: the camera sends no PVS320-style ack, so
  // don't wait (that would always report camera_timeout).
  if (camera.getProtocolMode() == ThermalCameraSerial::PROTOCOL_P6) {
    return okResult(successMessage);
  }
  if (!camera.awaitResponse()) {
    return errorResult("camera_timeout", "Camera did not respond in time");
  }

  return okResult(successMessage);
}

BleCommandResult ThermalCameraBleServer::refreshIdentityState(const String& successMessage) {
  // P6 cameras don't answer identity queries; report success with empty identity.
  if (camera.getProtocolMode() == ThermalCameraSerial::PROTOCOL_P6) {
    return okResult(successMessage);
  }
  if (!camera.refreshIdentity()) {
    return errorResult("device_unreachable", "Camera identity could not be refreshed");
  }

  return okResult(successMessage);
}

BleCommandResult ThermalCameraBleServer::applyProfileByIndex(uint8_t profileIndex) {
  if (!profiles.apply(profileIndex)) {
    return errorResult("profile_apply_failed", "Profile could not be applied");
  }

  return okResult("Profile applied");
}

BleCommandResult ThermalCameraBleServer::getProfileByIndex(uint8_t profileIndex, JsonObject result) {
  ThermalCameraProfile profile;
  if (!profiles.get(profileIndex, profile)) {
    return errorResult("invalid_profile", "Profile index must be 0-4");
  }

  populateProfileJson(result, profile, profileIndex);
  return okResult("Profile loaded");
}

void ThermalCameraBleServer::handleRpcPayload(const String& payload) {
  JsonDocument requestDoc;
  DeserializationError error = deserializeJson(requestDoc, payload);
  if (error) {
    publishRpcError("", "invalid_json", "Malformed RPC JSON");
    return;
  }

  const uint8_t version = requestDoc["v"] | 0;
  const char* type = requestDoc["type"] | "";
  const char* id = requestDoc["id"] | "";
  const char* op = requestDoc["op"] | "";

  if (version != PROTOCOL_VERSION) {
    publishRpcError(id, "protocol_mismatch", "Unsupported protocol version");
    return;
  }

  if (strcmp(type, "request") != 0) {
    publishRpcError(id, "invalid_type", "RPC payload must be a request");
    return;
  }

  if (!strlen(id)) {
    publishRpcError("", "missing_id", "RPC request is missing an id");
    return;
  }

  if (!strlen(op)) {
    publishRpcError(id, "missing_op", "RPC request is missing an op");
    return;
  }

  JsonDocument responseDoc;
  responseDoc["v"] = PROTOCOL_VERSION;
  responseDoc["type"] = "response";
  responseDoc["id"] = id;

  bool publishStateAfterResponse = false;
  int profileStateOverride = -1;
  BleCommandResult result = dispatchRpcRequest(
    String(id),
    String(op),
    requestDoc["args"],
    responseDoc,
    publishStateAfterResponse,
    profileStateOverride);

  if (!result.ok) {
    responseDoc["ok"] = false;
    responseDoc["code"] = result.code;
    responseDoc["message"] = result.message;
    lastErrorCode = result.code;
    lastErrorMessage = result.message;
    lastResponse = result.message;
  } else {
    responseDoc["ok"] = true;
    lastErrorCode = "";
    lastErrorMessage = "";
    lastResponse = result.message;
  }

  publishRpcResponse(responseDoc);
  publishLegacyStatus(true);

  if (publishStateAfterResponse) {
    if (profileStateOverride >= 0) {
      publishStateEventForProfile((uint8_t)profileStateOverride, true);
    } else {
      publishStateEvent(true);
    }
  }
}

BleCommandResult ThermalCameraBleServer::dispatchRpcRequest(
  const String& requestId,
  const String& op,
  JsonVariantConst args,
  JsonDocument& responseDoc,
  bool& publishStateAfterResponse,
  int& profileStateOverride) {
  (void)requestId;
  profileStateOverride = -1;
  publishStateAfterResponse = false;

  if (op == "auth.login") {
    const char* candidate = args["password"] | "";
    if (!strlen(candidate)) {
      return errorResult("invalid_args", "Password is required");
    }

    if (String(candidate) != password) {
      authenticated = false;
      authStatus = "denied";
      publishStateAfterResponse = true;
      return errorResult("auth_failed", "Incorrect password");
    }

    authenticated = true;
    authStatus = "confirmed";
    BleCommandResult identityResult = refreshIdentityState("Authenticated");
    publishStateAfterResponse = true;

    JsonObject result = responseDoc["result"].to<JsonObject>();
    result["authenticated"] = true;
    result["identityRefreshed"] = identityResult.ok;
    if (!identityResult.ok) {
      result["identityRefreshPending"] = true;
      queueIdentityRefresh(IDENTITY_REFRESH_RETRY_MS);
      return okResult("Authenticated");
    }

    return okResult("Authenticated");
  }

  if (op == "device.getCapabilities") {
    JsonObject result = responseDoc["result"].to<JsonObject>();
    result["protocolVersion"] = PROTOCOL_VERSION;
    result["deviceName"] = deviceName;
    JsonArray operations = result["operations"].to<JsonArray>();
    appendCapabilities(operations);
    return okResult("Capabilities ready");
  }

  if (!authenticated) {
    return errorResult("auth_required", "Authenticate first");
  }

  if (op == "device.setPassword") {
    String newPassword = String(args["password"] | "");
    if (!setPassword(newPassword)) {
      return errorResult("invalid_args", "password must be 4-32 characters with no spaces");
    }

    JsonObject result = responseDoc["result"].to<JsonObject>();
    result["passwordUpdated"] = true;
    publishStateAfterResponse = true;
    return okResult("BLE password updated");
  }

  if (op == "device.refreshIdentity") {
    BleCommandResult identityResult = refreshIdentityState("Device identity refreshed");
    publishStateAfterResponse = true;
    JsonObject result = responseDoc["result"].to<JsonObject>();
    result["identityRefreshed"] = identityResult.ok;
    if (!identityResult.ok) {
      return identityResult;
    }
    return okResult("Device identity refreshed");
  }

  if (op == "profile.get") {
    uint8_t profileIndex;
    if (!parseJsonUint8(args["profile"], 0, 4, profileIndex)) {
      return errorResult("invalid_args", "profile must be 0-4");
    }

    JsonObject result = responseDoc["result"].to<JsonObject>();
    return getProfileByIndex(profileIndex, result);
  }

  if (op == "profile.apply") {
    uint8_t profileIndex;
    if (!parseJsonUint8(args["profile"], 0, 4, profileIndex)) {
      return errorResult("invalid_args", "profile must be 0-4");
    }

    BleCommandResult result = applyProfileByIndex(profileIndex);
    if (!result.ok) return result;

    JsonObject response = responseDoc["result"].to<JsonObject>();
    response["profile"] = profileIndex;
    publishStateAfterResponse = true;
    return okResult("Profile applied");
  }

  if (op == "profile.save") {
    uint8_t profileIndex;
    uint8_t brightness;
    uint8_t contrast;
    uint8_t enhancement;
    if (!parseJsonUint8(args["profile"], 0, 4, profileIndex) ||
        !parseJsonUint8(args["brightness"], 0, 255, brightness) ||
        !parseJsonUint8(args["contrast"], 0, 7, contrast) ||
        !parseJsonUint8(args["enhancement"], 0, 7, enhancement)) {
      return errorResult("invalid_args", "profile save args are invalid");
    }

    profiles.set(profileIndex, brightness, contrast, enhancement);
    JsonObject response = responseDoc["result"].to<JsonObject>();
    response["profile"] = profileIndex;
    response["brightness"] = brightness;
    response["contrast"] = contrast;
    response["enhancement"] = enhancement;
    publishStateAfterResponse = true;
    return okResult("Profile saved");
  }

  if (op == "image.setBrightness") {
    uint8_t value;
    if (!parseJsonUint8(args["value"], 0, 255, value)) {
      return errorResult("invalid_args", "value must be 0-255");
    }

    camera.sendBrightness(value, false);
    BleCommandResult result = awaitCameraCommand("Brightness updated");
    if (!result.ok) return result;

    responseDoc["result"]["brightness"] = value;
    publishStateAfterResponse = true;
    return okResult("Brightness updated");
  }

  if (op == "image.setContrast") {
    uint8_t value;
    if (!parseJsonUint8(args["value"], 0, 7, value)) {
      return errorResult("invalid_args", "value must be 0-7");
    }

    camera.sendContrast(value, false);
    BleCommandResult result = awaitCameraCommand("Contrast updated");
    if (!result.ok) return result;

    responseDoc["result"]["contrast"] = value;
    publishStateAfterResponse = true;
    return okResult("Contrast updated");
  }

  if (op == "image.setEnhancement") {
    uint8_t value;
    if (!parseJsonUint8(args["value"], 0, 7, value)) {
      return errorResult("invalid_args", "value must be 0-7");
    }

    camera.sendEnhancement(value, false);
    BleCommandResult result = awaitCameraCommand("Enhancement updated");
    if (!result.ok) return result;

    responseDoc["result"]["enhancement"] = value;
    publishStateAfterResponse = true;
    return okResult("Enhancement updated");
  }

  if (op == "image.setPalette") {
    uint8_t value;
    if (!parseJsonUint8(args["value"], 0, 5, value)) {
      return errorResult("invalid_args", "value must be 0-5");
    }

    camera.sendPalette(value, false);
    BleCommandResult result = awaitCameraCommand("Palette updated");
    if (!result.ok) return result;

    responseDoc["result"]["palette"] = value;
    publishStateAfterResponse = true;
    return okResult("Palette updated");
  }

  if (op == "image.setZoom") {
    uint8_t value;
    if (!parseJsonUint8(args["value"], 1, 40, value)) {
      return errorResult("invalid_args", "value must be 1-40 (1-8 = 1.0x-4.0x, 10-40 = fine 0.1x steps)");
    }

    camera.sendZoom(value, false);
    BleCommandResult result = awaitCameraCommand("Zoom updated");
    if (!result.ok) return result;

    responseDoc["result"]["zoom"] = value;
    publishStateAfterResponse = true;
    return okResult("Zoom updated");
  }

  if (op == "calibration.manual") {
    camera.sendManualAdjust(false);
    BleCommandResult result = awaitCameraCommand("Manual calibration started");
    if (!result.ok) return result;
    publishStateAfterResponse = true;
    return okResult("Manual calibration started");
  }

  if (op == "calibration.screenAdjust") {
    camera.sendScreenAdjust(false);
    BleCommandResult result = awaitCameraCommand("Screen adjust started");
    if (!result.ok) return result;
    publishStateAfterResponse = true;
    return okResult("Screen adjust started");
  }

  if (op == "calibration.setAuto") {
    bool enabled = false;
    if (!parseJsonBool(args["enabled"], enabled)) {
      return errorResult("invalid_args", "enabled must be true or false");
    }
    camera.sendAuto(enabled, false);
    BleCommandResult result = awaitCameraCommand(enabled ? "Auto calibration enabled" : "Auto calibration disabled");
    if (!result.ok) return result;
    // Persist to the same NVS slot the physical rotary control restores on boot.
    Preferences p6prefs;
    if (p6prefs.begin("p6rotary", false)) {
      p6prefs.putBool("autocal", enabled);
      p6prefs.end();
    }
    responseDoc["result"]["enabled"] = enabled;
    publishStateAfterResponse = true;
    return okResult(enabled ? "Auto calibration enabled" : "Auto calibration disabled");
  }

  if (op == "calibration.dpc") {
    // Full dead-pixel correction + permanent save to the camera core (~3.2s).
    camera.runP6Dpc(false);
    publishStateAfterResponse = true;
    return okResult("Dead pixel correction complete");
  }

  if (op == "calibration.saveToCamera") {
    camera.sendP6Save(false);
    return okResult("Settings saved to camera");
  }

  if (op == "device.setBleName") {
    String newName = String(args["name"] | "");
    if (!setDeviceName(newName)) {
      return errorResult("invalid_args", "name must be 1-20 printable characters");
    }

    responseDoc["result"]["bleName"] = deviceName;
    publishStateAfterResponse = true;
    return okResult("BLE name updated");
  }

  if (op == "ota.start") {
    if (!ota.requestBeginWindow()) {
      return errorResult("ota_failed", "OTA window could not be started");
    }

    JsonObject result = responseDoc["result"].to<JsonObject>();
    result["otaActive"] = false;
    result["otaPending"] = true;
    result["otaRemainingMs"] = ota.remainingMs();
    return okResult("OTA window starting");
  }

  if (op == "ota.stop") {
    if (!ota.requestStopWindow()) {
      return errorResult("ota_inactive", "OTA window is not active");
    }

    JsonObject result = responseDoc["result"].to<JsonObject>();
    result["otaActive"] = false;
    result["otaRemainingMs"] = 0;
    publishStateAfterResponse = true;
    return okResult("OTA window stopped");
  }

  return errorResult("unknown_op", "Unknown op: " + op);
}

void ThermalCameraBleServer::handleCommand(String command) {
  command.trim();
  if (!command.length()) {
    publishLegacyResponse("ERR empty command");
    return;
  }

  if (!authenticated) {
    if (authenticateLegacy(command)) return;

    authStatus = "required";
    lastErrorCode = "auth_required";
    lastErrorMessage = "Password required";
    publishLegacyResponse("ERR password required");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("password ")) {
    publishLegacyResponse("OK already authenticated");
    return;
  }

  if (command == "get_status") {
    lastResponse = "OK get_status";
    lastErrorCode = "";
    lastErrorMessage = "";
    publishLegacyStatus(true);
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("get_profile ")) {
    uint8_t value;
    if (!parseProfileIndex(command.substring(12), value)) {
      publishLegacyResponse("ERR get_profile <0-4>");
      return;
    }
    lastResponse = "OK get_profile";
    publishLegacyStatus(true);
    publishStateEventForProfile(value, true);
    return;
  }

  if (command.startsWith("ble_name ")) {
    String newName = command.substring(9);
    if (!setDeviceName(newName)) {
      publishLegacyResponse("ERR ble_name <1-20 printable chars>");
      return;
    }
    publishLegacyResponse("OK set_ble_name");
    return;
  }

  if (command == "ota_start") {
    if (!ota.beginWindow()) {
      publishLegacyResponse("ERR ota_start failed");
      return;
    }
    publishLegacyResponse("OK ota_start");
    publishStateEvent(true);
    return;
  }

  if (command == "ota_stop") {
    if (!ota.requestStopWindow()) {
      publishLegacyResponse("ERR ota_stop inactive");
      return;
    }
    publishLegacyResponse("OK ota_stop");
    publishStateEvent(true);
    return;
  }

  if (command == "init") {
    camera.sendInit(false);
    BleCommandResult result = awaitCameraCommand("OK init");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command == "fw") {
    BleCommandResult result = refreshIdentityState("OK fw");
    publishLegacyResponse(result.ok ? result.message : "ERR device unreachable");
    publishStateEvent(true);
    return;
  }

  if (command == "model") {
    BleCommandResult result = refreshIdentityState("OK model");
    publishLegacyResponse(result.ok ? result.message : "ERR device unreachable");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("brightness ") || command.startsWith("set_brightness ")) {
    int offset = command.startsWith("brightness ") ? 11 : 15;
    uint8_t value;
    if (!parseValue(command.substring(offset), 0, 255, value)) {
      publishLegacyResponse("ERR brightness <0-255>");
      return;
    }
    camera.sendBrightness(value, false);
    BleCommandResult result = awaitCameraCommand("OK brightness");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("contrast ") || command.startsWith("set_contrast ")) {
    int offset = command.startsWith("contrast ") ? 9 : 13;
    uint8_t value;
    if (!parseValue(command.substring(offset), 0, 7, value)) {
      publishLegacyResponse("ERR contrast <0-7>");
      return;
    }
    camera.sendContrast(value, false);
    BleCommandResult result = awaitCameraCommand("OK contrast");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("enhancement ") || command.startsWith("set_enhancement ")) {
    int offset = command.startsWith("enhancement ") ? 12 : 16;
    uint8_t value;
    if (!parseValue(command.substring(offset), 0, 7, value)) {
      publishLegacyResponse("ERR enhancement <0-7>");
      return;
    }
    camera.sendEnhancement(value, false);
    BleCommandResult result = awaitCameraCommand("OK enhancement");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("palette ") || command.startsWith("set_palette ")) {
    int offset = command.startsWith("palette ") ? 8 : 12;
    uint8_t value;
    if (!parseValue(command.substring(offset), 0, 5, value)) {
      publishLegacyResponse("ERR palette <0-5>");
      return;
    }
    camera.sendPalette(value, false);
    BleCommandResult result = awaitCameraCommand("OK palette");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("profile_set ") || command.startsWith("set_profile_values ")) {
    int offset = command.startsWith("profile_set ") ? 12 : 19;
    uint8_t palette;
    uint8_t brightness;
    uint8_t contrast;
    uint8_t enhancement;
    if (!parseProfileSet(command.substring(offset), palette, brightness, contrast, enhancement)) {
      publishLegacyResponse("ERR profile_set <0-4> <0-255> <0-7> <0-7>");
      return;
    }
    profiles.set(palette, brightness, contrast, enhancement);
    publishLegacyResponse("OK profile_set");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("profile_get ")) {
    uint8_t value;
    if (!parseProfileIndex(command.substring(12), value)) {
      publishLegacyResponse("ERR profile_get <0-4>");
      return;
    }
    publishLegacyResponse("OK profile_get");
    publishStateEventForProfile(value, true);
    return;
  }

  if (command.startsWith("profile ") || command.startsWith("set_profile ")) {
    int offset = command.startsWith("profile ") ? 8 : 12;
    uint8_t value;
    if (!parseValue(command.substring(offset), 0, 4, value)) {
      publishLegacyResponse("ERR profile <0-4>");
      return;
    }
    BleCommandResult result = applyProfileByIndex(value);
    publishLegacyResponse(result.ok ? "OK profile" : "ERR profile apply failed");
    publishStateEvent(true);
    return;
  }

  if (command.startsWith("zoom ") || command.startsWith("set_zoom ")) {
    int offset = command.startsWith("zoom ") ? 5 : 9;
    uint8_t value;
    if (!parseValue(command.substring(offset), 1, 40, value)) {
      publishLegacyResponse("ERR zoom <1-40>");
      return;
    }
    camera.sendZoom(value, false);
    BleCommandResult result = awaitCameraCommand("OK zoom");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command == "sceen_adjust" || command == "action_sceen_adjust") {
    camera.sendScreenAdjust(false);
    BleCommandResult result = awaitCameraCommand("OK sceen_adjust");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command == "manual_adjust" || command == "action_manual_adjust") {
    camera.sendManualAdjust(false);
    BleCommandResult result = awaitCameraCommand("OK manual_adjust");
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command == "auto on" || command == "action_auto on" ||
      command == "auto off" || command == "action_auto off") {
    bool enabled = (command == "auto on" || command == "action_auto on");
    camera.sendAuto(enabled, false);
    BleCommandResult result = awaitCameraCommand(enabled ? "OK auto on" : "OK auto off");
    if (result.ok) {
      Preferences p6prefs;
      if (p6prefs.begin("p6rotary", false)) {
        p6prefs.putBool("autocal", enabled);
        p6prefs.end();
      }
    }
    publishLegacyResponse(result.ok ? result.message : "ERR camera timeout");
    publishStateEvent(true);
    return;
  }

  if (command == "dpc" || command == "action_dpc") {
    camera.runP6Dpc(false); // full DPC + save to camera core (~3.2s)
    publishLegacyResponse("OK dpc");
    publishStateEvent(true);
    return;
  }

  if (command == "camera_save" || command == "action_camera_save") {
    camera.sendP6Save(false);
    publishLegacyResponse("OK camera_save");
    return;
  }

  if (command == "action_ota_start") {
    if (!ota.beginWindow()) {
      publishLegacyResponse("ERR action_ota_start failed");
      return;
    }
    publishLegacyResponse("OK action_ota_start");
    publishStateEvent(true);
    return;
  }

  if (command == "action_ota_stop") {
    if (!ota.requestStopWindow()) {
      publishLegacyResponse("ERR action_ota_stop inactive");
      return;
    }
    publishLegacyResponse("OK action_ota_stop");
    publishStateEvent(true);
    return;
  }

  publishLegacyResponse("ERR unknown command");
}

void ThermalCameraBleServer::configureAdvertising(NimBLEAdvertising* bleAdvertising) {
  if (!bleAdvertising) return;

  bleAdvertising->stop();
  bleAdvertising->reset();
  bleAdvertising->setName(deviceName.c_str());
  bleAdvertising->addServiceUUID(SERVICE_UUID);
  bleAdvertising->enableScanResponse(true);
  bleAdvertising->setPreferredParams(0x06, 0x12);
  bleAdvertising->addTxPower();
  bleAdvertising->refreshAdvertisingData();
}

void ThermalCameraBleServer::restartAdvertising() {
  NimBLEAdvertising* bleAdvertising = NimBLEDevice::getAdvertising();
  if (bleAdvertising) {
    configureAdvertising(bleAdvertising);
    bleAdvertising->start();
  } else {
    NimBLEDevice::startAdvertising();
  }
  advertising = true;
  Serial.println("BLE advertising");
}

void ThermalCameraBleServer::resetBleSessions() {
  if (!server) {
    restartAdvertising();
    return;
  }

  Serial.println("BLE password changed; resetting BLE sessions");

  server->stopAdvertising();
  advertising = false;

  std::vector<uint16_t> peers = server->getPeerDevices();
  for (uint16_t connHandle : peers) {
    if (server->disconnect(connHandle)) {
      Serial.print("BLE client disconnected: ");
      Serial.println(connHandle);
    }
  }

  connected = false;
  restartAdvertising();
}

void ThermalCameraBleServer::queueBleReset() {
  pendingBleReset = true;
  pendingBleResetAtMs = millis() + BLE_RESET_GRACE_MS;
}

void ThermalCameraBleServer::queueIdentityRefresh(unsigned long delayMs) {
  pendingIdentityRefresh = true;
  pendingIdentityRefreshAtMs = millis() + delayMs;
}
