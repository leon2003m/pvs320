# Thermal Camera Control Platform

This repository bundles the two main parts of the project:

1. `260407-195439-adafruit_qtpy_esp32c3`
The ESP32-C3 firmware that talks to the thermal camera over UART, exposes BLE control, stores image profiles, and supports temporary Wi-Fi OTA updates.

2. `pvs-320-app`
The browser-based control app used to connect to the ESP32 over Web Bluetooth, adjust image settings, manage profiles, review debug logs, and trigger OTA mode.

Together, these projects form a complete control platform for a UART-connected thermal camera module.

## What It Does

The platform lets you:

- connect an ESP32-C3 to the thermal camera over UART
- control the camera from a web app over BLE
- read camera identity information such as model and firmware
- change image settings like brightness, contrast, enhancement, palette, and zoom
- save and recall persistent image profiles
- rename the BLE device and change the BLE command password
- trigger a temporary OTA Wi-Fi access point for wireless firmware updates
- inspect BLE and app-side debug traffic in the web UI

## Repository Layout

```text
.
├── 260407-195439-adafruit_qtpy_esp32c3
│   ├── src/
│   ├── docs/
│   ├── platformio.ini
│   └── README.md
├── pvs-320-app
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.ts
│   └── README.md
└── README.md
```

## Platform Architecture

The data flow is:

```text
Thermal Camera <-> UART <-> ESP32-C3 Firmware <-> BLE <-> Web App
```

The firmware is responsible for:

- serial framing and parsing for the camera
- BLE authentication and command handling
- profile storage in NVS
- OTA access point lifecycle
- publishing device state back to BLE clients

The web app is responsible for:

- scanning for the BLE controller
- authenticating with the device password
- sending control commands
- showing current device state
- editing profiles and BLE settings
- showing local and optional webserver-backed debug logs

## Firmware Project

Location:
`260407-195439-adafruit_qtpy_esp32c3`

Main firmware features:

- PlatformIO-based Arduino firmware for ESP32-C3
- UART communication with the thermal camera
- BLE command and status interface
- profile button support
- persistent profile storage
- OTA Wi-Fi update mode

Main entry point:

- `src/ThermalCameraController.ino`

Important modules:

- `src/ThermalCameraSerial.*`
- `src/ThermalCameraBleServer.*`
- `src/ThermalCameraProfiles.*`
- `src/ThermalCameraOta.*`
- `src/ThermalCameraProfileButton.*`

Build firmware:

```bash
cd 260407-195439-adafruit_qtpy_esp32c3
pio run -e esp32c3_supermini
```

Flash firmware over USB:

```bash
pio run -e esp32c3_supermini -t upload
```

Open the serial monitor:

```bash
pio device monitor -e esp32c3_supermini
```

The firmware project has a more detailed technical reference in:

- `260407-195439-adafruit_qtpy_esp32c3/docs/TECHNICAL_REFERENCE.md`

## Web App Project

Location:
`pvs-320-app`

Main web app features:

- React + Vite frontend
- Web Bluetooth connection to the ESP32-C3
- control page for image settings
- settings page for OTA, password, BLE name, and profiles
- debug console for BLE traffic and optional webserver log mirroring

Install dependencies:

```bash
cd pvs-320-app
npm install
```

Run the development server:

```bash
npm run dev
```

Typecheck the app:

```bash
npm run lint
```

By default the development server runs on:

```text
https://localhost:3000
```

Because the app uses Web Bluetooth, it should be served from a secure context such as `https://...` or `localhost`.

## Typical Usage

1. Flash the ESP32-C3 firmware.
2. Power the camera and ESP32-C3 hardware.
3. Start the web app locally.
4. Open the app in a browser that supports Web Bluetooth.
5. Scan for the BLE device and connect.
6. Authenticate with the configured BLE password.
7. Use the control and settings screens to operate the camera.

