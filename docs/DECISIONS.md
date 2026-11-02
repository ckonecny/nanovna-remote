# Decisions and hardware findings

Newest first within each section. Record new decisions here as they are made.

## Architecture

- **Transparent bridge, evaluation in the browser.** The ESP32 forwards bytes between a
  WebSocket and the NanoVNA's USB serial port. Only one bridge session at a time; a pump
  task is the sole reader of the port's stream buffer. Reason: the browser has the CPU,
  the charting and the update path; the firmware stays small.
- **Persistent USB port pool** (`shared_ptr<Port>`): the port stays open while the
  device is attached. An OTA update ends the bridge session and calls `vna_usb_release()`
  first, because a USB interrupt while the flash cache is off crashes the chip.
- **Client embedded in the firmware** as gzip assets (`client_assets.cpp`, generated at
  build time by `tools/embed_client.py` from `client/dist`). GPL-2.0 client and
  GPL-3.0-or-later firmware stay separate; the client is only data in the image.
- **Calibration is app-side, per band, stored on the ESP.** Ideal open (+1), short (-1),
  load (0): `G = (Gm - Ed) / (Er + Es (Gm - Ed))`. One connection of each standard calibrates
  all HAM bands (101 points per band, band +-15 % margin). Stored in the browser's
  localStorage and pushed to `/api/appcal` (SPIFFS `/spiffs/appcal.json`, max 400 KB); the
  device copy wins on connect, so any browser sees the same calibration.
  Rationale: the NanoVNA's own 5-slot calibration cannot cover all bands at full accuracy.
- **Partitions**: nvs, otadata, phy_init, ota_0/ota_1 (0x180000 each), storage (SPIFFS,
  0xE0000). Firmware is about 1.3 MB (85 % of a slot) after the display UI.

## WiFi (multi-network, 2026-11)

- Up to 8 networks in NVS namespace `wifinets` (ssid, password, enabled), plus the SSID
  joined last. The old single-network namespace `wifi` is imported once.
- Boot: scan, try enabled networks that are in range (last used first, 10 s each). If none
  works, open the setup WiFi `NanoVNA-Remote` (APSTA, channel 6, HT20, catch-all DNS,
  captive portal). The setup WiFi retries the stored networks every 60 s while nobody is
  connected to it, unless it was opened on purpose (button or D0 at boot).
- **D0 at boot no longer clears anything**; it opens the setup WiFi. Networks are removed
  one by one on the web page or in the device menu. Reason: with several networks a
  wipe-all gesture is too destructive, and D0 is now the "up" button.
- Passwords are entered only on the web page (`/wifi`), never on the device. The API never
  returns passwords.
- HT40 caused large transfers to stall on some phones; the AP uses 20 MHz.
- mDNS name is `nanovna` (`nanovna.local`); it does not resolve everywhere, the IP is on
  the display.

## Display and buttons (2026-11)

- Display via ESP-IDF `esp_lcd` (ST7789, SPI2, 40 MHz), no framebuffer: text is drawn as one
  DMA bitmap per line (max 16 lines of 240 px), fills in strips. Colours are RGB565 with the
  bytes swapped. Pins: MOSI 35, SCLK 36, CS 42, DC 40, RST 41, backlight 45, TFT power 7
  (must be high).
- Landscape: swap_xy, mirror(flipped, !flipped), gap (40, 53). The 180 degree turn is a
  setting (menu "Rotate display", NVS `ui/flipped`). Gap 52 in the turned position showed one
  unwritten RAM line at the bottom; 53 is right for both.
- The 5x7 font (Adafruit GFX glcdfont, BSD) uses **8 rows**: row 7 holds descenders of g, p,
  q, y, j. Drawing only 7 rows cuts them off.
- Buttons: D0 = GPIO0 active low with pull-up; D1/D2 = GPIO1/2 active high, **no pull-downs on
  the board**, so the internal ones are enabled. Debounce 30 ms, long press 600 ms, optional
  double click 300 ms (delays that button's short press, off by default).
- **The FreeRTOS tick is 10 ms.** `vTaskDelay(pdMS_TO_TICKS(5))` is 0 ticks and returns at
  once: a polling task then starves the idle task and the task watchdog resets the chip
  (this happened with the first button task). Poll intervals are at least 10 ms.
- UI model: a stack of screens, each producing 8 rows of 20 characters (16 px rows, text
  scale 2); only changed rows are redrawn. Navigation changes requested by a key handler
  are applied after the handler returns, so a screen is never destroyed under its own
  handler. Idle for 30 s returns to the status screen.
- Source of the display/button wiring and polarity: the user's morserino-32-nano project
  (Arduino/LovyanGFX there, ESP-IDF here, so only pins and logic are reused).

## NanoVNA-H behaviour (verified on hardware)

- `resume` restarts the sweep. `data 0` returns immediately with the previous sweep's values
  for points not yet measured. A 101-point sweep takes about 0.6 s; the client waits
  900 ms (`SWEEP_MS`) before reading. Early "identical curves" diagnoses were this effect,
  not a hang.
- `cal off` returns raw data (used for the app-side calibration).
- A Feather reset in the middle of a transfer can hang the NanoVNA's USB stack; restart the
  NanoVNA then.
- In USB host mode the Feather's USB-C is not a serial port any more; logs: `/log` (16 KB
  ring buffer).

## Licenses

- `firmware/` GPL-3.0-or-later. Started as a port of akarpf/nanovna-tuner (copyright
  Andreas Karpf); that code was removed from the project.
- `client/` GPL-2.0, upstream cho45/NanoVNA-WebClient.
- `firmware/src/font5x7.h`: Adafruit GFX 5x7 font, BSD license (Adafruit Industries).
