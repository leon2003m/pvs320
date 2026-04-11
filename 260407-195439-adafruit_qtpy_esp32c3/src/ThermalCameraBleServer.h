#ifndef THERMAL_CAMERA_BLE_SERVER_H
#define THERMAL_CAMERA_BLE_SERVER_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include "ThermalCameraProfiles.h"
#include "ThermalCameraSerial.h"
#include "ThermalCameraOta.h"

class ThermalCameraBleServer;

struct BleCommandResult {
  bool ok;
  const char* code;
  String message;
};

class ThermalCameraBleCallbacks : public NimBLEServerCallbacks {
public:
  explicit ThermalCameraBleCallbacks(ThermalCameraBleServer& bleServerRef);

  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override;
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override;

private:
  ThermalCameraBleServer& bleServer;
};

class ThermalCameraBleCommandCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit ThermalCameraBleCommandCallbacks(ThermalCameraBleServer& bleServerRef);

  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo) override;

private:
  ThermalCameraBleServer& bleServer;
};

class ThermalCameraBleRpcCallbacks : public NimBLECharacteristicCallbacks {
public:
  explicit ThermalCameraBleRpcCallbacks(ThermalCameraBleServer& bleServerRef);

  void onWrite(NimBLECharacteristic* characteristic, NimBLEConnInfo& connInfo) override;

private:
  ThermalCameraBleServer& bleServer;
};

class ThermalCameraBleServer {
public:
  ThermalCameraBleServer(
    ThermalCameraSerial& cameraRef,
    ThermalCameraProfiles& profilesRef,
    ThermalCameraOta& otaRef,
    const char* deviceName);

  void begin();
  void update();
  void setConnected(bool isConnected);
  void handleCommand(String command);
  void handleRpcPayload(const String& payload);
  bool setPassword(String newPassword);
  bool setDeviceName(String newName);
  String getDeviceName() const;

private:
  ThermalCameraSerial& camera;
  ThermalCameraProfiles& profiles;
  ThermalCameraOta& ota;
  Preferences preferences;
  const char* bleDeviceName;
  NimBLEServer* server;
  NimBLECharacteristic* legacyStatusCharacteristic;
  NimBLECharacteristic* protocolCharacteristic;
  NimBLECharacteristic* rpcCharacteristic;
  NimBLECharacteristic* stateCharacteristic;
  NimBLECharacteristic* logCharacteristic;
  bool connected;
  bool advertising;
  bool authenticated;
  unsigned long lastStatusMs;
  bool lastPublishedOtaActive;
  bool pendingBleReset;
  unsigned long pendingBleResetAtMs;
  bool pendingIdentityRefresh;
  unsigned long pendingIdentityRefreshAtMs;
  String lastResponse;
  String authStatus;
  String password;
  String deviceName;
  uint32_t stateSequence;
  String lastErrorCode;
  String lastErrorMessage;

  String buildLegacyStatusJson() const;
  String buildLegacyStatusJson(const ThermalCameraProfile* overrideProfile, int overrideIndex) const;
  String buildProtocolJson() const;
  String buildStateJson() const;
  String buildStateEnvelopeJson() const;
  String buildStateObjectJson(const ThermalCameraProfile* overrideProfile, int overrideIndex) const;
  void populateStateJson(JsonObject state, const ThermalCameraProfile* overrideProfile, int overrideIndex) const;
  void populateProfileJson(JsonObject profileJson, const ThermalCameraProfile& profile, uint8_t profileIndex) const;
  String jsonEscape(const String& value) const;
  String jsonAge(unsigned long updatedMs) const;
  void publishLegacyStatus(bool forceNotify);
  void publishLegacyResponse(const String& response);
  void publishProtocolMetadata();
  void publishStateEvent(bool forceNotify);
  void publishStateEventForProfile(uint8_t profileIndex, bool forceNotify);
  void publishRpcResponse(const JsonDocument& responseDoc);
  void publishRpcError(const String& id, const char* code, const String& message);
  void publishRpcLog(const String& message);
  bool notifyJsonChunks(NimBLECharacteristic* characteristic, const String& payload);
  bool authenticateLegacy(String command);
  bool isValidPassword(String newPassword) const;
  bool isValidDeviceName(String newName) const;
  void loadPassword();
  void savePassword();
  void loadDeviceName();
  void saveDeviceName();
  bool parseValue(String text, uint8_t minValue, uint8_t maxValue, uint8_t& value) const;
  bool parseProfileSet(String text, uint8_t& palette, uint8_t& brightness, uint8_t& contrast, uint8_t& enhancement) const;
  bool parseProfileIndex(String text, uint8_t& palette) const;
  BleCommandResult awaitCameraCommand(const String& successMessage);
  BleCommandResult refreshIdentityState(const String& successMessage);
  BleCommandResult applyProfileByIndex(uint8_t profileIndex);
  BleCommandResult getProfileByIndex(uint8_t profileIndex, JsonObject result);
  BleCommandResult dispatchRpcRequest(const String& requestId, const String& op, JsonVariantConst args, JsonDocument& responseDoc, bool& publishStateAfterResponse, int& profileStateOverride);
  void appendCapabilities(JsonArray operations) const;
  void queueIdentityRefresh(unsigned long delayMs = 1200);
  void resetBleSessions();
  void queueBleReset();
  void configureAdvertising(NimBLEAdvertising* advertising);
  void restartAdvertising();

  friend class ThermalCameraBleCallbacks;
  friend class ThermalCameraBleCommandCallbacks;
  friend class ThermalCameraBleRpcCallbacks;
};

#endif
