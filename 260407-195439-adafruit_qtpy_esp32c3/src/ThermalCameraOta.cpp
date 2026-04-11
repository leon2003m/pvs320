#include <ArduinoOTA.h>
#include <WiFi.h>
#include "ThermalCameraOta.h"

static const IPAddress OTA_AP_IP(192, 168, 8, 1);
static const IPAddress OTA_AP_GATEWAY(192, 168, 8, 1);
static const IPAddress OTA_AP_SUBNET(255, 255, 255, 0);
static const int OTA_AP_CHANNEL = 11;
static const int OTA_AP_HIDDEN = 0;
static const int OTA_AP_MAX_CLIENTS = 1;
static const unsigned long OTA_START_GRACE_MS = 250;
static const unsigned long OTA_STOP_GRACE_MS = 250;

ThermalCameraOta::ThermalCameraOta(
  const char* ssid,
  const char* apPasswordValue,
  const char* otaPasswordValue,
  const char* hostname)
  : apSsid(ssid),
    apPassword(apPasswordValue),
    otaPassword(otaPasswordValue),
    otaHostname(hostname),
    startedMs(0),
    startRequestedMs(0),
    stopRequestedMs(0),
    active(false),
    startRequested(false),
    stopRequested(false) {
}

bool ThermalCameraOta::beginWindow() {
  if (active) {
    startedMs = millis();
    startRequested = false;
    startRequestedMs = 0;
    stopRequested = false;
    stopRequestedMs = 0;
    Serial.println("OTA window extended to 5 minutes");
    return true;
  }

  return activateWindow();
}

bool ThermalCameraOta::requestBeginWindow() {
  if (active) {
    startedMs = millis();
    startRequested = false;
    startRequestedMs = 0;
    stopRequested = false;
    stopRequestedMs = 0;
    Serial.println("OTA window extended to 5 minutes");
    return true;
  }

  startRequested = true;
  startRequestedMs = millis();
  stopRequested = false;
  stopRequestedMs = 0;
  Serial.println("OTA start requested");
  return true;
}

bool ThermalCameraOta::activateWindow() {
  startRequested = false;
  startRequestedMs = 0;

  WiFi.persistent(false);
  WiFi.disconnect(true, true);
  delay(100);
  WiFi.mode(WIFI_AP);
  WiFi.setSleep(false);
  WiFi.softAPConfig(OTA_AP_IP, OTA_AP_GATEWAY, OTA_AP_SUBNET);

  bool apStarted = false;
  if (apPassword && strlen(apPassword) >= 8) {
    apStarted = WiFi.softAP(apSsid, apPassword, OTA_AP_CHANNEL, OTA_AP_HIDDEN, OTA_AP_MAX_CLIENTS);
  } else {
    apStarted = WiFi.softAP(apSsid, nullptr, OTA_AP_CHANNEL, OTA_AP_HIDDEN, OTA_AP_MAX_CLIENTS);
  }

  if (!apStarted) {
    Serial.println("ERR: OTA WiFi AP failed to start");
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_OFF);
    return false;
  }

  ArduinoOTA.setHostname(otaHostname);
  if (otaPassword && strlen(otaPassword)) {
    ArduinoOTA.setPassword(otaPassword);
  }

  ArduinoOTA.onStart([]() {
    Serial.println("OTA update started");
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("OTA update finished");
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    if (!total) return;
    Serial.print("OTA progress: ");
    Serial.print((progress * 100U) / total);
    Serial.println("%");
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.print("OTA error: ");
    Serial.println((int)error);
  });

  ArduinoOTA.begin();
  startedMs = millis();
  startRequestedMs = 0;
  stopRequestedMs = 0;
  active = true;
  startRequested = false;
  stopRequested = false;

  Serial.print("OTA WiFi SSID: ");
  Serial.println(apSsid);
  if (apPassword && strlen(apPassword) >= 8) {
    Serial.print("OTA WiFi password: ");
    Serial.println(apPassword);
  }
  Serial.print("OTA IP: ");
  Serial.println(WiFi.softAPIP());
  Serial.print("OTA hostname: ");
  Serial.println(otaHostname);
  Serial.println("OTA window active for 5 minutes");
  return true;
}

bool ThermalCameraOta::stopWindow() {
  if (!active) {
    Serial.println("OTA window already closed");
    return false;
  }

  endWindow();
  return true;
}

bool ThermalCameraOta::requestStopWindow() {
  if (startRequested && !active) {
    startRequested = false;
    startRequestedMs = 0;
    Serial.println("OTA start cancelled before activation");
    return true;
  }

  if (!active) {
    Serial.println("OTA window already closed");
    return false;
  }

  stopRequested = true;
  stopRequestedMs = millis();
  Serial.println("OTA stop requested");
  return true;
}

void ThermalCameraOta::update() {
  if (startRequested && !active) {
    if (millis() - startRequestedMs >= OTA_START_GRACE_MS) {
      if (!activateWindow()) {
        startRequested = false;
        startRequestedMs = 0;
      }
    }
    return;
  }

  if (!active) return;

  ArduinoOTA.handle();

  if (stopRequested && millis() - stopRequestedMs >= OTA_STOP_GRACE_MS) {
    endWindow();
    return;
  }

  if (millis() - startedMs >= OTA_WINDOW_MS) {
    endWindow();
  }
}

bool ThermalCameraOta::isActive() const {
  return active;
}

bool ThermalCameraOta::isStartPending() const {
  return startRequested && !active;
}

unsigned long ThermalCameraOta::remainingMs() const {
  if (!active) return 0;

  unsigned long elapsed = millis() - startedMs;
  if (elapsed >= OTA_WINDOW_MS) return 0;
  return OTA_WINDOW_MS - elapsed;
}

void ThermalCameraOta::endWindow() {
  if (!active) return;

  ArduinoOTA.end();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  active = false;
  stopRequested = false;
  stopRequestedMs = 0;
  Serial.println("OTA window closed; WiFi off");
}
