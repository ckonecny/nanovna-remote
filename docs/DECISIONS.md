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
- **Calibration check with the kit standards only (2026-11, issue #6 stays open).** After
  the 14-band calibration the same open, short and load were measured again in Multi, all
  bands. Load: min SWR 1.00 (160/80 m), 1.01 (60-12 m), 1.02 (10/6 m), 1.03 (4 m), 1.04 (2 m),
  1.07 (70 cm), i.e. |G| <= 0.034 (return loss >= 29 dB) at 70 cm. Open: SWR > 99 (|G| >= 0.98)
  on 160-40 m, "infinite" from 30 m up. Short: "infinite" in all bands. This only shows that
  the calibration reproduces its own standards (repeatability, residual directivity); it says
  nothing about a real mismatch because the standards are assumed ideal. The SWR display
  rounds to two decimals and caps at 99, so open/short deviations below about 1 % are not
  visible. A real accuracy figure needs an independent known mismatch (25/100 ohm resistor
  or a 75 ohm load).
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

## Simulator, screenshots and feature page (2026-11)
- `dev-tools/simulator.py` imitates the bridge: serves `client/dist` (build with `npm run build:esp`), `/api/appcal` and the
  NanoVNA text shell on `/ws`. It needs `aiohttp` (`pip install aiohttp` in `dev-tools/venv`); `websockets` alone cannot
  serve the PUT of `/api/appcal`. The raw readings carry error terms, so the app's own OSL calibration works on them.
  `GET /sim/dut/<name>` picks what is connected (antenna, open, short, load, cable-open, cable-short, cable-fault).
  The values are modelled, never measured: screenshots made from it say so (manual, feature page).
- `dev-tools/screenshots/shots.mjs` (puppeteer-core with the installed Chrome) takes the phone shots (390x844 at 2x, dark
  and some light) and a few desktop shots into `site/img/`; the manual links them from there.
- `site/` is the feature page (dark, English and German in one file, language switch); `.github/workflows/pages.yml`
  publishes it to GitHub Pages. Pages has to be enabled in the repository settings (source: GitHub Actions) and needs a
  public repository on the free plan.

## Live demo on GitHub Pages (2026-11)
- `npm run build:demo` (mode `demo`, `client/.env.demo` sets `VITE_ESP` and `VITE_DEMO`) builds the app into `client/dist-demo`
  with a simulated NanoVNA in the page: `client/src/lib/demo.js` has `DemoSocket`, which `NanoVNA_WebSocket` uses instead of
  `WebSocket` when `VITE_DEMO` is set, so all the ESP-mode behaviour stays the same. The models are a JS port of
  `dev-tools/simulator.py` (keep both in step).
- What is attached is chosen in `DemoPanel.vue`; the choice reaches the worker (which owns the transport) through a
  `BroadcastChannel`. `pullFromDevice`/`pushToDevice` do nothing in the demo: the calibration stays in the browser's
  localStorage. The PWA plugin is disabled for the demo (no offline cache).
- The ESP build does not contain the demo code (checked: no demo strings in `client/dist`), so the flash budget is unchanged.
- `pages.yml` builds the demo and publishes it next to the feature page under `/demo/` (`site/` + `client/dist-demo`).
  It also runs on changes in `client/`.

## Firmware version and display orientation (2026-11)
- `tools/version.py` (PlatformIO pre-script) writes `src/version.h` (`FW_VERSION`, ignored by git) from `git describe --tags --always --dirty`:
  `v1.1.0` on a tag build, `v1.1.0-3-gabc123` between tags, `-dirty` with local changes. Shown in the menu under About (the status screen is too full) and logged at boot (`/log`).
- The display is rotated by default now (`ui_flipped_get` defaults to 1): with a fresh flash the image was upside down relative to the
  button labels, D0/D2 were reversed. A saved choice from the menu still wins.

## QR code on the device display (2026-11)
- `firmware/src/qr.cpp` draws a QR code with Nayuki's C generator (v1.8.0, MIT, vendored unmodified in `src/third_party/qrcodegen/`).
  Error correction L, version 1 to 4, black on white with a 2-module quiet zone, as large as the 135 px height allows
  (WiFi payload `WIFI:T:WPA;S:<ssid>;P:<password>;;` is version 3, 29 modules, 4 px each, 132 px). Flash +0.8 percentage points.
- `ui.cpp`: `QrScreen` (D2 on the status screen; opens by itself when the setup WiFi starts and no other screen is open). It paints
  itself instead of rows of text (`Screen::draw`) and is exempt from the 30 s return to the status screen. Content: the join code
  while in setup mode, `http://<ip>/` while on a network, otherwise a note. The existing captive portal (dns.cpp) then opens the setup page.
- Verified on the device (v1.1.0): the code shows, the iPhone camera joins the setup WiFi from it. The iPhone did not open the setup page by itself,
  so in setup mode a second page of the QR screen (D1) holds `http://192.168.4.1/wifi`, and the DHCP server now also offers it as RFC 8910
  captive portal URI (option 114). Whether option 114 makes the iPhone open the page is not verified.

## Update page on the device (2026-11)

`/update` is a small page served by the firmware: file picker, upload progress, shows the installed version (`/api/info`).
It POSTs the `-update.bin` to the existing `/api/ota`. It lives on the device (plain http, same origin) because the
installer page on https cannot call a http device (mixed content); the installer stays USB-only (Web Serial).

## Release binaries (2026-11)
- A tag `v*` runs `release.yml`: client tests and `build:esp`, firmware build, then `esptool merge_bin` (the esptool that
  PlatformIO installs) joins bootloader 0x0, partition table 0x8000, otadata 0xf000 and app 0x20000 into one
  `*-first-flash.bin` (checked byte for byte against the single files; 4 MB, dio, 80 MHz). `*-update.bin` is the plain app
  for `/api/ota`. `SHA256SUMS` is attached; the release notes carry the flash commands. The merged image also erases NVS
  (stored WiFi networks), so the notes say it is for the first installation.
- Browser installer: `site/install/` uses ESP Web Tools 10.4.0 (Apache-2.0), vendored unmodified in
  `site/install/vendor/esp-web-tools/` (pinned, no CDN at runtime). `pages.yml` downloads the first-flash image of the latest
  release into `_site/install/firmware-<version>.bin` (the version in the name, and a time stamp on the manifest URL, because Pages caches for 10 minutes and an old cached image would otherwise be flashed) and writes `manifest.json` (same origin: GitHub release assets send no CORS
  headers); `release.yml` starts `pages.yml` after publishing (a release made with the workflow token does not trigger
  `on: release`). The Feather's USB port is not a serial port while the firmware runs, so the page tells the user to enter
  the ROM bootloader first (D0 + RESET). Web Serial: Chrome/Edge only, not Firefox/Safari/iOS. The image overwrites NVS
  (WiFi networks) but not the `storage` partition (calibration, 0x320000).
- Not tested yet: flashing the merged image on the device and a real tag run of the workflow.

## Touch operation and colour scheme (2026-11)
- Colour scheme: `store.theme` is `auto` (system) / `light` / `dark`; the header button cycles through all three (it used to
  toggle only light/dark). The light scheme is tuned for contrast (black text, darker primary and curve, stronger grid lines)
  because it is meant for use in sunlight; no separate "high contrast" scheme. `<meta name="theme-color">` follows the scheme.
  The manifest's static `theme_color` stays `#ffffff` (PWA work is issue #17).
- Touch size: `--tap` (36 px, 48 px with `(pointer: coarse)`) is the minimum height of tappable controls; shared `.pill` and
  `.field-input` classes in `style.css` replace the per-view copies. Inputs use 16 px text, because iOS zooms the page into
  smaller fields. The tab bar scrolls sideways (`flex-shrink: 0`, else it collapses to 1 px in a short column).
- Swipe between views (`App.vue`): only quick (<600 ms), clearly horizontal (>=90 px and twice the vertical move) one-finger
  moves that start outside charts, fields, buttons, sideways-scrolling areas and the 24 px screen edges (browser back gesture).
  Switching a view can start another kind of sweep (Multi, Cable, TDR), so accidental switches must stay rare.
- Landscape on a phone (`orientation: landscape` and height <= 500 px): in Smith and Freq the inputs sit left of the chart.
- HAM cursor: `store.hamCursor` (Hz, not saved) so that the tap in the chart and the keypad ("Frequency…", via App.vue) set the
  same cursor; it snaps to the nearest measured point and is hidden when outside the sweep. The values sit in a bar above the
  chart (below the fold on a phone otherwise). `store.hamCursorMode` (`manual` / `min` / `max`, not saved): min and max follow the
  lowest / highest SWR inside the band on every sweep, like the NanoVNA's marker search; a tap or the keypad switches to manual.
  The return loss and R/X charts show the cursor's values as dots plus an exact readout in the chart title. The markers of the side menu stay limited to Smith and Freq.
- Tested only in the browser (demo mode, emulated viewport, synthetic touch events); not yet on a real phone.

## Build reproducibility (2026-11)
- `client/dsp-wasm/web/` (the wasm DSP package of cho45's client, built by wasm-pack from `client/dsp-wasm/`) is tracked in
  git although wasm-pack writes a `.gitignore` for it: without it a fresh clone cannot build or test the client (CI found
  this). Rebuilding needs Rust and wasm-pack (`make -C client/dsp-wasm`); then `git add -f` the changed files.
- `firmware/platformio.ini` pins `espressif32@6.11.0` (ESP-IDF 5.4.1). A newer platform failed to build (stricter
  `gpio_num_t` and `-Werror=type-limits`); the code is fixed for both, the pin keeps builds the same everywhere. Raise it on purpose.

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

- `firmware/` GPL-3.0-or-later.
- `client/` GPL-2.0, upstream cho45/NanoVNA-WebClient.
- `firmware/src/font5x7.h`: Adafruit GFX 5x7 font, BSD license (Adafruit Industries).
