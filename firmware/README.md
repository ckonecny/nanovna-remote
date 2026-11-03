# NanoVNA Remote - firmware for the ESP32-S3 (Adafruit Reverse TFT Feather, #5691)

The Feather is the USB host for a NanoVNA-H (text shell protocol, VID/PID 0483:5740; a NanoVNA V2 with binary protocol
is passed through as well). It joins your WiFi and does three things:

- **Bridge:** `ws://<ip>/ws` passes bytes unchanged between a browser and the NanoVNA's USB serial port. All commands and
  evaluation live in the web app. One session at a time; a new tab takes over.
- **Web app:** the built client (`../client/dist`) is gzip-embedded into the firmware image (`tools/embed_client.py`) and
  served from `/`.
- **Services:** WiFi setup (`/wifi`), over-the-air update (`/api/ota`), the calibration of the web app
  (`/api/appcal`, kept in flash so every browser sees the same one), a log of recent events (`/log`).

## Ready-made binaries

Releases (tag `v*`, built by `.github/workflows/release.yml`) carry `*-first-flash.bin` (bootloader, partition table, otadata
and app in one file, written once at offset 0x0 with `esptool.py --chip esp32s3 write_flash 0x0 <file>`) and `*-update.bin`
(the app only, `curl --data-binary @file http://<ip>/api/ota`). The first-flash image overwrites the stored WiFi networks.

## Build and flash

```sh
(cd ../client && npm run build:esp)                  # the client is embedded, build it first
python3 -m platformio run -e feather -t upload       # first flash over USB
tools/ota.sh <feather-ip>                            # every later update over WiFi
```

The USB-C port is the host port once the firmware runs, so it no longer shows up as a serial port. To flash over USB
again: hold **D0 (BOOT)**, tap **RESET**, release D0. There is no serial console while USB is in host mode; read the
log at `http://<ip>/log`.

## WiFi

- Up to 8 networks are stored (NVS), edited on the `/wifi` page or chosen with the buttons (see `../manual/manual_en.md`).
  At boot the Feather tries the stored networks in range, the last used first.
- If none can be joined it opens its own WiFi `NanoVNA-Remote` (password `nanovna-remote`, see `src/wifi_mgr.h`; change it
  before using the device anywhere public). It runs a captive portal (catch-all DNS + redirect), so phones offer to sign in and
  open the setup page by themselves, and it looks for the stored networks again every minute while nobody is connected.
- Hold **D0 (BOOT)** while powering up or resetting to open the setup WiFi right away. Nothing is deleted.

## Display and buttons

ST7789 via `esp_lcd` (`src/display.cpp`), buttons with debouncing (`src/buttons.cpp`), screens and menus in `src/ui.cpp`.
D0 = up, D2 = down, D1 short = confirm, D1 long = menu / back. Design notes: `../docs/DECISIONS.md`.

## Hardware notes

- A Feather does not supply 5 V on USB-C. Connect the NanoVNA through a USB-C OTG adapter or hub that is powered
  externally, and power the Feather from LiPo or its own supply. A NanoVNA with its own battery also works through an
  OTG adapter that contains a hub.
- Flash budget: the image is about 1.3 MB of the 1.5 MB app slot. If more features are added, move the client into the
  `storage` partition.

## Behaviour worth knowing

- The NanoVNA-H's `data` command answers at once with the previous sweep for points not measured yet, and `resume`
  restarts the sweep (about 0.6 s for 101 points). The web app waits one sweep after a range change.
- A Feather reset or crash in the middle of a transfer can leave the NanoVNA's USB stack hung; restart the NanoVNA then.
  The OTA handler therefore ends bridge sessions and releases the USB port before flashing.
