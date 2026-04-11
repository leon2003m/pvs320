# Thermal Camera ESP32-C3 Technical Reference

This document describes the firmware architecture, UART command framing, BLE protocol, command set, parameter ranges, profile storage, button behavior, and OTA workflow for the ESP32-C3 thermal camera controller.

## 1. System Overview

The firmware runs on an ESP32-C3 and has five main responsibilities:

1. Communicate with the thermal camera over UART.
2. Expose a BLE control interface for a mobile app.
3. Store and apply persistent image profiles.
4. Cycle profiles with an external button.
5. Open a temporary WiFi AP for OTA updates.

Main entry point:

- [`src/ThermalCameraController.ino`](../src/ThermalCameraController.ino)

Modules:

- [`src/ThermalCameraSerial.h`](../src/ThermalCameraSerial.h)
- [`src/ThermalCameraSerial.cpp`](../src/ThermalCameraSerial.cpp)
- [`src/ThermalCameraProfiles.h`](../src/ThermalCameraProfiles.h)
- [`src/ThermalCameraProfiles.cpp`](../src/ThermalCameraProfiles.cpp)
- [`src/ThermalCameraProfileButton.h`](../src/ThermalCameraProfileButton.h)
- [`src/ThermalCameraProfileButton.cpp`](../src/ThermalCameraProfileButton.cpp)
- [`src/ThermalCameraBleServer.h`](../src/ThermalCameraBleServer.h)
- [`src/ThermalCameraBleServer.cpp`](../src/ThermalCameraBleServer.cpp)
- [`src/ThermalCameraOta.h`](../src/ThermalCameraOta.h)
- [`src/ThermalCameraOta.cpp`](../src/ThermalCameraOta.cpp)

## 2. Hardware Configuration

Current compile-time constants:

- USB serial baud: `115200`
- Camera UART baud: `500000`
- Camera TX pin: `GPIO 20`
- Camera RX pin: `GPIO 21`
- Profile button pin: `GPIO 10`
- BLE device name: `ThermalCamera`

Button wiring:

```text
GPIO 10 ---- button ---- GND
```

The button uses `INPUT_PULLUP`, so no external pull-up resistor is required.

## 3. Runtime Architecture

Main loop order:

1. Read CLI input from USB serial.
2. Update camera UART parser.
3. Update profile button debounce state.
4. Update BLE state.
5. Update OTA handler.

This means:

- UART frame parsing is always active.
- BLE command handling is app-driven.
- OTA is only active during a temporary update window.
- The profile button works independently of BLE and serial CLI.

## 4. Camera UART Protocol

### 4.1 Frame Format

All outgoing camera commands use this general frame layout:

```text
# <op> <cmd> <len_lo> <len_hi> <payload bytes...> <checksum> END
```

Where:

- `#` is `0x23`
- `op` is usually `R` or `W`
- `cmd` is the command byte
- `len_lo`, `len_hi` are the payload length in little-endian order
- `checksum` is the sum of payload bytes modulo 256
- `END` is `0x45 0x4E 0x44`

Firmware implementation:

- checksum helper: [`src/ThermalCameraSerial.cpp`](../src/ThermalCameraSerial.cpp)
- generic sender: [`src/ThermalCameraSerial.cpp`](../src/ThermalCameraSerial.cpp)

### 4.2 Checksum Rule

Checksum is:

```text
sum(payload bytes) & 0xFF
```

Examples:

- brightness payload `[value, 0x00]` -> checksum `value`
- contrast payload `[value, 0x80]` -> checksum `value + 0x80`
- enhancement payload `[0x01, value]` -> checksum `0x01 + value`
- auto payload `16 bytes` -> checksum is the sum of all 16 payload bytes

### 4.3 Incoming Frame Parsing

UART receive behavior:

- The parser waits for `#` before collecting a frame.
- Bytes are appended until the frame buffer ends with `END`.
- If debug mode is enabled, raw incoming bytes are printed in hex.
- Frames for firmware and model responses are decoded into strings and cached.

Response storage:

- firmware string
- model string
- timestamp of last firmware update
- timestamp of last model update

These cached values are what BLE publishes to the app.

### 4.4 Timeouts

UART timeout constant:

- `FRAME_TIMEOUT_MS = 600`

Behavior:

- If a frame starts but does not finish within 600 ms, it is discarded.
- If a request is sent and no response starts within 600 ms, the pending request is cleared.
- Timeout text is only printed in debug mode.

Debug timeout strings:

- `ERR: frame timeout`
- `ERR: response timeout`

## 5. Camera Command Reference

This section documents the implemented commands, CLI syntax, BLE command syntax, payload format, and known value ranges.

### 5.1 Query Commands

#### `init`

Purpose:

- Initialize or wake the camera interface.

CLI / BLE command:

```text
init
```

UART write:

```text
op = 'W'
cmd = 0x98
payload = [0x01, 0x01]
```

#### `fw`

Purpose:

- Query firmware version text from the camera.

CLI / BLE command:

```text
fw
```

UART write:

```text
op = 'R'
cmd = 0x5A
payload = [0x00, 0x00]
```

Response handling:

- printable payload is cached as `firmware`

#### `model`

Purpose:

- Query model name text from the camera.

CLI / BLE command:

```text
model
```

UART write:

```text
op = 'R'
cmd = 0x57
payload = [0x00, 0x00]
```

Response handling:

- printable payload is cached as `model`

### 5.2 Image Controls

#### `brightness <0-255>`

Purpose:

- Set brightness.

Range:

- `0..255`

CLI / BLE command:

```text
brightness 120
```

UART write:

```text
op = 'W'
cmd = 0x31
payload = [value, 0x00]
checksum = value
```

#### `contrast <0-7>`

Purpose:

- Set contrast.

Range:

- `0..7`

CLI / BLE command:

```text
contrast 3
```

UART write:

```text
op = 'W'
cmd = 0x32
payload = [value, 0x80]
checksum = value + 0x80
```

#### `enhancement <0-7>`

Purpose:

- Set enhancement or sharpening level.

Range:

- `0..7`

CLI / BLE command:

```text
enhancement 4
```

UART write:

```text
op = 'W'
cmd = 0x29
payload = [0x01, value]
checksum = 0x01 + value
```

#### `palette <0-4>`

Purpose:

- Set thermal palette index.

Range:

- `0..4`

CLI / BLE command:

```text
palette 2
```

UART write:

```text
op = 'W'
cmd = 0x23
payload = [value, 0x00]
checksum = value
```

Note:

- Palette names are not defined in firmware. Only numeric indices `0..4` are used.

#### `zoom <1-8>`

Purpose:

- Set zoom level.

Range:

- `1..8`

CLI / BLE command:

```text
zoom 2
```

UART write:

```text
op = 'W'
cmd = 0x44
payload = [value, 0x00]
checksum = value
```

### 5.3 Adjustment / Calibration Commands

#### `sceen_adjust`

Purpose:

- Send command `0x06`.
- The firmware uses the user-requested command name `sceen_adjust`.

CLI / BLE command:

```text
sceen_adjust
```

UART write:

```text
op = 'W'
cmd = 0x06
payload = [0x00, 0x00]
checksum = 0x00
```

Effect:

- Function is currently treated as an image or screen adjustment trigger.
- Exact device-side behavior still needs real hardware validation.

#### `manual_adjust`

Purpose:

- Send command `0x05`.

CLI / BLE command:

```text
manual_adjust
```

UART write:

```text
op = 'W'
cmd = 0x05
payload = [0x00, 0x00]
checksum = 0x00
```

Effect:

- Likely a manual calibration or adjustment trigger.
- Exact device-side behavior still needs real hardware validation.

#### `auto on`

Purpose:

- Enable auto mode.

CLI / BLE command:

```text
auto on
```

UART write:

```text
op = 'W'
cmd = 0x67
payload length = 16
payload[0] = 0x0D
payload[1..15] = 0x00
```

#### `auto off`

Purpose:

- Disable auto mode.

CLI / BLE command:

```text
auto off
```

UART write:

```text
op = 'W'
cmd = 0x67
payload length = 16
payload[0] = 0x01
payload[1..15] = 0x00
```

Effect:

- Likely controls an automatic image optimization mode.
- Exact camera behavior depends on the module.

## 6. Serial CLI Reference

The USB serial CLI is available at `115200` baud.

Supported commands:

```text
init
fw
model
brightness <0-255>
contrast <0-7>
enhancement <0-7>
palette <0-4>
profile <0-4>
profile_get <0-4>
profile_set <p> <b> <c> <e>
profile_show
zoom <1-8>
sceen_adjust
manual_adjust
auto <on|off>
ota_start
ble_password <pw>
ble_name <name>
debug
help
```

Invalid input handling:

- unknown commands return:

```text
Unknown command. Type 'help' for available commands.
```

Validation examples:

- `brightness` must be `0..255`
- `contrast` must be `0..7`
- `enhancement` must be `0..7`
- `palette` must be `0..4`
- `profile` must be `0..4`
- `zoom` must be `1..8`
- BLE password must be `4..32` characters and contain no spaces

Debug mode:

- `debug` toggles UART hex dump and timeout printing
- debug mode affects serial output only

## 7. Profile System

### 7.1 Purpose

Profiles are a per-palette bundle of:

- palette index
- brightness
- contrast
- enhancement

They are stored persistently in ESP32 NVS.

### 7.2 Storage

NVS namespace:

- `tc_profiles`

Per-profile keys:

- `p0b`, `p0c`, `p0e`
- `p1b`, `p1c`, `p1e`
- `p2b`, `p2c`, `p2e`
- `p3b`, `p3c`, `p3e`
- `p4b`, `p4c`, `p4e`

Stored values:

- brightness as unsigned byte
- contrast as unsigned byte
- enhancement as unsigned byte

Palette index itself is implied by the selected slot `0..4`.

### 7.3 Default Profiles

```text
Profile  Palette  Brightness  Contrast  Enhancement
0        0        120         3         3
1        1        140         4         4
2        2        160         5         5
3        3        100         2         2
4        4        180         6         6
```

### 7.4 Applying a Profile

Command:

```text
profile <0-4>
```

Apply order:

1. `sendPalette()`
2. delay `50 ms`
3. `sendBrightness()`
4. delay `50 ms`
5. `sendContrast()`
6. delay `50 ms`
7. `sendEnhancement()`

### 7.5 Updating a Profile

Command:

```text
profile_set <profile> <brightness> <contrast> <enhancement>
```

Example:

```text
profile_set 2 150 4 5
```

This updates the in-memory profile and immediately saves it to NVS.

### 7.6 Printing Profiles

CLI command:

```text
profile_show
```

This is serial-only. BLE does not currently provide a dedicated `profile_show` command.

## 8. External Profile Button

Button module:

- [`src/ThermalCameraProfileButton.cpp`](../src/ThermalCameraProfileButton.cpp)

Behavior:

- pin mode: `INPUT_PULLUP`
- idle state: `HIGH`
- pressed state: `LOW`
- debounce: `50 ms`

On each valid press:

- active profile increments by 1
- wraps around using `profileCount`
- selected profile is applied immediately

Current implementation starts from profile `0` at boot and advances on first press to profile `1`.

## 9. BLE Interface

### 9.1 Overview

BLE is the primary app interface.

Device name:

```text
ThermalCamera
```

Service UUID:

```text
b7d10000-6f2d-4f9a-9c11-2f43a0000001
```

Characteristics:

- status characteristic: `b7d10001-6f2d-4f9a-9c11-2f43a0000001`
- command characteristic: `b7d10002-6f2d-4f9a-9c11-2f43a0000001`

Advertising notes:

- service UUID is advertised
- scan response is enabled
- advertising restarts automatically after disconnect

### 9.2 BLE Authentication

BLE uses an application-level password, not BLE pairing security.

Default password:

```text
changeme
```

Authentication command:

```text
password changeme
```

Rules:

- password length: `4..32`
- spaces are not allowed

Storage:

- NVS namespace: `tc_ble`
- key: `password`

Changing password:

- serial CLI command:

```text
ble_password <newPassword>
```

Behavior when password changes:

- saved to NVS immediately
- existing BLE sessions are forced back to locked state

### 9.3 Pull API Model

Recommended mobile app sequence:

1. Scan for `ThermalCamera`.
2. Connect.
3. Subscribe to notifications on the status characteristic, or read it after writes.
4. Send `password <pw>` to the command characteristic.
5. Wait until status JSON reports `"authenticated": true`.
6. Explicitly request state with `get_status` and `get_profile <n>`.
7. Send `set_*` or `action_*` commands as needed.

The BLE API is now pull-oriented:

- there is no periodic one-second status push
- the app requests current state with `get_status`
- the app requests stored profile data with `get_profile <n>`
- command results are returned by notifying the status characteristic once per request

If not authenticated:

- non-password commands return `ERR password required`

If wrong password is sent:

- response is `ERR wrong password`

If password is sent after authentication:

- response is `OK already authenticated`

### 9.4 BLE Status JSON

Status is published when the app requests it or when a BLE command completes.

Current status JSON shape:

```json
{
  "bleName": "ThermalCamera",
  "palette": 2,
  "brightness": 160,
  "contrast": 5,
  "enhancement": 5,
  "activeProfile": 2,
  "model": "...",
  "firmware": "...",
  "modelAgeMs": 1234,
  "firmwareAgeMs": 1234,
  "authenticated": true,
  "otaActive": false,
  "otaRemainingMs": 0,
  "last": "OK authenticated"
}
```

Field meanings:

- `bleName`: current advertised BLE device name
- `palette`: current live palette
- `brightness`: current live brightness
- `contrast`: current live contrast
- `enhancement`: current live enhancement
- `activeProfile`: currently selected profile slot
- `model`: last cached camera model string
- `firmware`: last cached firmware string
- `modelAgeMs`: milliseconds since the model string was last updated, or `null`
- `firmwareAgeMs`: milliseconds since the firmware string was last updated, or `null`
- `authenticated`: whether the BLE session is unlocked
- `otaActive`: whether OTA WiFi/AP mode is currently active
- `otaRemainingMs`: milliseconds remaining in the OTA window
- `last`: most recent BLE command result

### 9.5 BLE Command Reference

Supported BLE commands after authentication:

```text
get_status
get_profile <0-4>
set_ble_name <name>
set_brightness <0-255>
set_contrast <0-7>
set_enhancement <0-7>
set_palette <0-4>
set_zoom <1-8>
set_profile <0-4>
set_profile_values <0-4> <0-255> <0-7> <0-7>
action_manual_adjust
action_sceen_adjust
action_auto on
action_auto off
action_ota_start
```

Compatibility note:

- legacy commands such as `brightness 120`, `profile 2`, `profile_get 2`, `ble_name X`, and `ota_start` still work
- new app code should prefer the pull API command set above

BLE responses are not returned as direct write responses. The command result is written into the `last` field of the status JSON and notified on the status characteristic.

Typical response values:

```text
OK authenticated
OK get_status
OK get_profile
OK set_ble_name
OK set_brightness
OK set_contrast
OK set_enhancement
OK set_palette
OK set_profile
OK set_profile_values
OK set_zoom
OK action_sceen_adjust
OK action_manual_adjust
OK action_auto on
OK action_auto off
OK action_ota_start
ERR empty command
ERR password required
ERR wrong password
ERR unknown command
ERR get_profile <0-4>
ERR set_ble_name <1-20 printable chars>
ERR set_brightness <0-255>
ERR set_contrast <0-7>
ERR set_enhancement <0-7>
ERR set_palette <0-4>
ERR set_profile <0-4>
ERR set_profile_values <0-4> <0-255> <0-7> <0-7>
ERR set_zoom <1-8>
ERR action_ota_start failed
```

### 9.6 BLE App Integration Notes

When writing a BLE client:

- write plain ASCII command strings
- trim newline characters on the app side if present
- after authentication, call `get_status` to populate the UI
- call `get_profile <n>` when the user opens a profile editor for slot `n`
- parse the notified JSON payload after each command
- use `last` as the primary command status
- do not treat connection alone as authorization

A BLE client should consider the device ready only when:

```json
"authenticated": true
```

## 10. OTA Update Mode

OTA is intentionally off by default.

Start command:

```text
ota_start
```

Can be triggered from:

- serial CLI
- authenticated BLE command interface

### 10.1 OTA Window Properties

Window length:

- `5 minutes`

AP configuration:

- SSID: `ThermalCameraOTA`
- WiFi password: `changeme`
- IP: `192.168.8.1`
- gateway: `192.168.8.1`
- subnet: `255.255.255.0`
- channel: `11`
- hidden SSID: `false`
- max clients: `1`

ArduinoOTA configuration:

- hostname: `thermal-camera`
- OTA password: `changeme`

If `ota_start` is called while already active:

- the timer is reset back to 5 minutes

### 10.2 OTA Lifecycle

When OTA starts:

1. current WiFi state is cleared
2. AP mode is enabled
3. AP is configured and started
4. ArduinoOTA is initialized
5. status JSON reports `otaActive = true`

While active:

- `ArduinoOTA.handle()` is called in the main loop

When the 5-minute window expires:

1. `ArduinoOTA.end()` is called
2. the AP is disconnected
3. WiFi is turned off
4. status JSON reports `otaActive = false`

### 10.3 PlatformIO OTA Upload

OTA upload environment:

- `esp32c3_supermini_ota`

Typical upload command:

```powershell
pio run -e esp32c3_supermini_ota -t upload
```

Default non-OTA USB serial environment:

- `esp32c3_supermini`

Typical USB upload command:

```powershell
pio run -e esp32c3_supermini -t upload
```

## 11. Storage Summary

NVS namespaces used by the firmware:

- `tc_profiles`
- `tc_ble`

Stored values:

- profile brightness/contrast/enhancement per profile slot
- BLE password
- BLE advertised name

These settings survive reboot.

## 12. Known Constraints

1. The command name `sceen_adjust` is intentionally misspelled to match the current external interface.
2. BLE authentication is application-level only and is not equivalent to BLE bonding/pairing security.
3. Palette names are not known in firmware. The interface uses numeric palette indices only.
4. `profile_show` is available on serial CLI but not exposed as a BLE command.
5. OTA, BLE, and WiFi together leave limited flash headroom in the OTA partition layout.

## 13. Example BLE Session

Example app sequence:

1. Connect to BLE device `ThermalCamera`.
2. Subscribe to notifications on `b7d10001-6f2d-4f9a-9c11-2f43a0000001`.
3. Write to `b7d10002-6f2d-4f9a-9c11-2f43a0000001`:

```text
password changeme
```

4. Wait for notified JSON:

```json
{
  "authenticated": true,
  "last": "OK authenticated"
}
```

5. Request current state:

```text
get_status
```

6. Request stored profile 2:

```text
get_profile 2
```

7. Apply profile 2:

```text
set_profile 2
```

8. Update profile 2:

```text
set_profile_values 2 150 4 5
```

9. Start OTA:

```text
action_ota_start
```

10. Watch status JSON:

```json
{
  "otaActive": true,
  "otaRemainingMs": 299000,
  "last": "OK action_ota_start"
}
```
