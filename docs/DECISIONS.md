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

## Multi-band view (2026-11)
- Done in the client only: the update loop sweeps the selected bands one after another (`bandSweep` range,
  `setRange`, `resume`, wait `SWEEP_MS`, read), because the NanoVNA-H has one sweep range at a time.
- Each band is corrected with its own OSL calibration; a band without one is shown uncorrected and flagged.
- Leaving the view restores the device to the range held in the store.

## Cable view (2026-11)
- Length from the slope of the unwrapped reflection phase of an open/shorted cable over a wide sweep
  (`lib/cable.js`); loss from the reflection magnitude (round trip, halved). Client only; the readings are raw, the
  app-side HAM calibration is not applied.
- Unwrapping needs less than half a turn between points, so the sweep limits the cable length (150 m / 20 m at VF 0.66).
  A longer cable aliases into a straight line and shows a shorter length; a single sweep cannot detect that.
- The NanoVNA has a delay of its own (measured 0.2 to 2 ns with nothing attached, varying between runs and not yet
  understood): the view has a Zero button that subtracts the delay measured with nothing attached, per sweep.
- Characteristic impedance: Z0 = sqrt(Zoc * Zsc) from an open and a shorted sweep of the same cable. This holds for any
  length and loss; points with either impedance outside 3 to 3000 ohm are skipped (ill-conditioned), the median is
  reported with the spread of the real part. Raw readings: accuracy depends on the device calibration of the sweep.
- Stub helper: shortest shorted/open stub for a reactance (x = Z0 tan(bl), x = -Z0 / tan(bl)); no matching of a
  measured load (single-stub matching) yet.

## Export in HAM and Multi (2026-11)
- `lib/export.js`. The SVG charts are turned into PNG by cloning the SVG, copying the computed styles (CSS variables do
  not exist in a standalone image) onto the clone, drawing it on a canvas in the page's colours; several charts are
  stacked with a title each. The .s1p contains what the view shows (app calibration already applied), same layout as the
  side menu's export. The buttons live in the side menu (Save section), not in the views, so that all saving is in one
  place; the menu entries act on the current tab. File names are `<band>-<date>`; Multi saves one .s1p per measured band, 300 ms apart.

## TDR view (2026-11)
- Replaces the chart.js TDR of the original client (time axis only, no distance, no marker, window/DC handling for an
  unsuitable sweep). New `lib/tdr.js`; the sweep runs on a harmonic grid (start = step, stop = 101 start) so that it
  is a proper low-pass spectrum; the response is evaluated directly from the 101 points (no FFT).
- Range = v / (2 step), resolution about 1.5 v / (2 bandwidth) (Hamming window). Three sweeps: 3-303 MHz, 1-101 MHz, 0.3-30.3 MHz.
- No step response and no impedance profile: they need the reflection at 0 Hz, which the NanoVNA cannot measure and which
  cannot be estimated from the first point (its phase has turned by up to a circle). Impulse response only.
- The response repeats every `range`; the NanoVNA's own delay puts the connector slightly before 0 m, so the last
  4 resolutions of the range are shown as negative distances. The marker starts 2 resolutions after 0 m and needs a
  size of at least 0.05.
- The worker's `calcTDR` (wasm FFT) is no longer used by the UI.

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
