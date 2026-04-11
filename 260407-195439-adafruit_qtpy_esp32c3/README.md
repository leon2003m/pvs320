# Thermal Camera ESP32-C3 Controller

PlatformIO firmware for an ESP32-C3 thermal camera controller. It talks to the camera over UART, exposes control over BLE for a MIT App Inventor app, supports persistent image profiles, and includes a temporary WiFi OTA update mode.

For a full protocol and implementation reference, see:

- [TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md)

## Hardware

- ESP32-C3 board, currently configured as `esp32-c3-devkitm-1`
- Camera UART baud: `500000`
- Camera TX from ESP32-C3: GPIO `20`
- Camera RX into ESP32-C3: GPIO `21`
- Profile button: GPIO `10` to GND
- The profile button uses the ESP32 internal pull-up, so no external resistor is required.

Button wiring:

```text
GPIO 10 ---- button ---- GND
```

## Build And Upload

Default upload is USB serial through `esptool`:

```powershell
pio run -e esp32c3_supermini -t upload
```

Serial monitor:

```powershell
pio device monitor -e esp32c3_supermini
```

The default environment is set in `platformio.ini`:

```ini
[platformio]
default_envs = esp32c3_supermini
```

## BLE App Protocol

Use the MIT App Inventor BluetoothLE extension/component. This is BLE, not classic Bluetooth.

A Flutter companion app source is also available in [`app/thermal_camera_app`](app/thermal_camera_app/README.md).

Device name:

```text
ThermalCamera
```

Service UUID:

```text
b7d10000-6f2d-4f9a-9c11-2f43a0000001
```

Status characteristic, read + notify:

```text
b7d10001-6f2d-4f9a-9c11-2f43a0000001
```

Command characteristic, write:

```text
b7d10002-6f2d-4f9a-9c11-2f43a0000001
```

After connecting, the app must write the BLE password command before other commands work:

```text
password changeme
```

The serial CLI can change the BLE password:

```text
ble_password newpass123
```

Passwords must be 4-32 characters with no spaces and are saved across reboot.

## BLE Status JSON

The status characteristic returns JSON:

```json
{
  "model": "...",
  "firmware": "...",
  "modelAgeMs": 1234,
  "firmwareAgeMs": 1234,
  "rxPin": 21,
  "authenticated": true,
  "otaActive": false,
  "otaRemainingMs": 0,
  "last": "OK authenticated"
}
```

The app should display `model`, `firmware`, `authenticated`, `otaActive`, `otaRemainingMs`, and `last`.

## Commands

Commands can be sent from the serial console or, after BLE authentication, through the BLE command characteristic.

```text
init
fw
model
brightness <0-255>
contrast <0-7>
enhancement <0-7>
palette <0-4>
profile <0-4>
profile_set <profile> <brightness> <contrast> <enhancement>
profile_show
zoom <1-8>
sceen_adjust
manual_adjust
auto <on|off>
ota_start
debug
help
```

Examples:

```text
profile 2
profile_set 2 150 4 5
brightness 120
auto on
ota_start
```

## Profiles

Profiles store brightness, contrast, and enhancement per palette. They are saved in ESP32 NVS and survive reboot.

Default profiles:

```text
palette brightness contrast enhancement
0       120        3        3
1       140        4        4
2       160        5        5
3       100        2        2
4       180        6        6
```

The external button cycles through profiles `0` to `4` and wraps back to `0`.

## OTA Updates

OTA is disabled by default. Start the OTA window with:

```text
ota_start
```

This enables a WiFi AP for 5 minutes:

```text
SSID: ThermalCameraOTA
WiFi password: changeme
IP: 192.168.8.1
OTA hostname: thermal-camera
OTA auth password: changeme
```

Connect the PC to `ThermalCameraOTA`, then upload with:

```powershell
pio run -e esp32c3_supermini_ota -t upload
```

Important: after changing partition layouts, perform one USB serial upload first.

## Project Notes

- `ThermalCameraController.ino` is the main entry point.
- `ThermalCameraSerial.*` owns UART protocol framing and parsing.
- `ThermalCameraProfiles.*` owns persistent image profiles.
- `ThermalCameraBleServer.*` owns BLE app communication and password gating.
- `ThermalCameraOta.*` owns temporary WiFi OTA mode.
- `ThermalCameraProfileButton.*` owns the debounced profile cycle button.

The firmware is close to the custom OTA partition limit because BLE + WiFi + ArduinoOTA are all included. Keep an eye on PlatformIO flash usage after adding features.
