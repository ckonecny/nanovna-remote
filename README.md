# NanoVNA Remote

Measure antennas with a NanoVNA from any browser on your WiFi, without a computer next to the antenna.

An Adafruit ESP32-S3 Reverse TFT Feather (#5691) acts as USB host for a NanoVNA-H, joins your WiFi and serves a web
app. Open `http://<feather-ip>/` on a phone or computer and measure. Nothing has to be installed.

```
 NanoVNA-H --USB-- ESP32-S3 Feather --WiFi-- browser (all the evaluation happens here)
```

- **firmware/** - ESP-IDF firmware (PlatformIO). Transparent WebSocket to USB-serial bridge, serves the web app,
  WiFi setup page, over-the-air updates, stores the calibration. See [firmware/README.md](firmware/README.md).
- **client/** - the web app (Vue 3, Vite). Based on cho45's
  [NanoVNA-Web-Client](https://github.com/cho45/NanoVNA-WebClient) and extended: Single frequency and HAM band views,
  an app-side open/short/load calibration for all ham bands at once, dark mode, a no-data notice. See
  [client/README.md](client/README.md).
- **manual/** - user manual, English and German. Project notes for contributors and Claude sessions: `CLAUDE.md`, `docs/`.
- **dev-tools/** - small Python scripts for testing the bridge from a computer.

## Quick start

1. Build the client, then the firmware (the firmware embeds the client):
   ```sh
   cd client && npm install && npm run build:esp
   cd ../firmware && python3 -m platformio run -e feather -t upload
   ```
2. On first start the Feather opens a WiFi `NanoVNA-Remote` (password `nanovna-remote`); the display shows it. Join it, open
   <http://192.168.4.1/wifi>, scan, pick your network, enter the password, save and press Connect. You can store up to 8
   networks (home, phone hotspot, ...) and switch between them with the Feather's buttons (D0 up, D2 down, D1 confirm).
3. Open `http://<feather-ip>/` (the address is on the display) (also `http://nanovna.local/` where mDNS works), tap Connect, and calibrate once on the
   HAM tab (open, short, load, each connected once).

Later firmware updates go over WiFi: `firmware/tools/ota.sh <feather-ip>`.

## Licenses

- `firmware/` is GPL-3.0-or-later. It started as a port of [akarpf/nanovna-tuner](https://github.com/akarpf/nanovna-tuner)
  (copyright Andreas Karpf); the original tuner code is no longer part of this project.
- `client/` is GPL-2.0 (see `client/COPYING`, upstream cho45/NanoVNA-WebClient). It is built separately and only
  embedded into the firmware image as data, so both licenses stay apart.
