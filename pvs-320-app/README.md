<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# PVS-320 Web App

This app provides the browser UI for the thermal camera controller. It runs as a Vite React app in development and can also be built into a Docker image for local or remote hosting.

View the original AI Studio app: https://ai.studio/apps/cafa83d3-d0cd-45d7-bb4f-9ffcb67f4add

## Run Locally

Prerequisite: Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in `.env.local` if you use Gemini-backed features
3. Start the HTTPS development server:
   `npm run dev`

The dev server runs on `https://localhost:3000` and includes the local `/__logs/ble` endpoint used by the debug console.

## Run Production Build Without Docker

1. Build the app:
   `npm run build`
2. Start the production server:
   `npm run start`

The production server listens on `http://localhost:3000` by default, serves the built SPA from `dist/`, and keeps the `/__logs/ble` endpoint available for debug log mirroring.

Environment variables:

- `PORT` controls the HTTP port and defaults to `3000`
- `BLE_LOG_PATH` controls where mirrored BLE logs are stored and defaults to `/tmp/ble-live.log`

## Docker

Build the image from `pvs-320-app`:

```bash
docker build -t pvs-320-app .
```

Run it locally:

```bash
docker run --rm -p 3000:3000 pvs-320-app
```

Then open `http://localhost:3000`.

If you want log persistence across container restarts, provide a writable log path or mount a volume:

```bash
docker run --rm -p 3000:3000 \
  -e BLE_LOG_PATH=/data/ble-live.log \
  -v "$(pwd)/.docker-data:/data" \
  pvs-320-app
```

Example Compose setup:

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d
```

The example file:

- runs `ghcr.io/leon2003m/pvs320-app:latest`
- publishes port `3000`
- persists mirrored BLE logs in `./.docker-data`
- restarts automatically unless stopped

## Web Bluetooth Note

Web Bluetooth requires a secure context. That means:

- local Docker usage on `localhost` works without extra TLS setup
- non-local hosting should be placed behind HTTPS, such as a reverse proxy or ingress controller that terminates TLS

The container itself only serves plain HTTP and is intended to sit behind HTTPS when deployed remotely.
