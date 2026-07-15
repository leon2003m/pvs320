#ifndef THERMAL_CAMERA_ROTARY_CONTROL_H
#define THERMAL_CAMERA_ROTARY_CONTROL_H

#include <Arduino.h>
#include <Preferences.h>
#include <AiEsp32RotaryEncoder.h>
#include "ThermalCameraSerial.h"
#include "ThermalCameraOta.h"

// Physical control surface ported from the standalone "P6 thermal controller"
// sketch: a rotary encoder (zoom / brightness / contrast / palette), a thumb
// button (manual NUC, auto-cal toggle, OTA hotspot toggle) and an on-board
// status LED. All camera traffic goes through the P6 packet protocol on the
// shared ThermalCameraSerial, and the 10s "hotspot" gesture reuses the existing
// OTA Wi-Fi access point, so the BLE web app keeps working unchanged.
//
// Gesture map (identical to the original sketch):
//   Rotate                        -> zoom
//   Thumb + rotate                -> brightness
//   Encoder click                 -> next palette
//   Thumb + encoder click         -> next contrast step
//   Thumb + encoder hold 3s       -> dead-pixel correction (DPC) + save
//   Thumb tap (<0.5s)             -> manual NUC
//   Thumb hold 5s                 -> toggle auto-cal (persisted)
//   Thumb hold 10s                -> toggle OTA hotspot (Wi-Fi AP)
class ThermalCameraRotaryControl {
public:
  ThermalCameraRotaryControl(ThermalCameraSerial& cameraRef,
                             ThermalCameraOta& otaRef,
                             uint8_t rotaryAPin,
                             uint8_t rotaryBPin,
                             uint8_t rotarySwPin,
                             uint8_t thumbPin,
                             uint8_t ledPin);

  void begin();
  void update();

  // Called from the file-scope ISR trampoline; the encoder library needs a
  // plain function pointer, so the instance is reached via a static pointer.
  void handleEncoderIsr();

private:
  void runDpc();

  ThermalCameraSerial& camera;
  ThermalCameraOta& ota;
  Preferences preferences;
  AiEsp32RotaryEncoder encoder;

  uint8_t rotaryA;
  uint8_t rotaryB;
  uint8_t rotarySw;
  uint8_t thumbBtn;
  uint8_t led;

  // Live state (mirrors the original sketch's globals)
  int brightness;
  int contrastIdx;
  int palette;
  int zoomVal;
  bool autoCalEnabled;

  // Timing / edge-detection flags
  unsigned long thumbDownTime;
  unsigned long encDownTime;
  unsigned long lastBtnPressTime;
  unsigned long thumbActionCooldown;
  bool thumbWasInteracted;
  bool b5s;
  bool b10s;
};

#endif
