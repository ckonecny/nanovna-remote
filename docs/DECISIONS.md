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

## Port extension and firmware note (2026-11)
- The device's `edelay` / `s21offset` do not apply: the app switches the device calibration off and corrects the raw readings
  itself (see app-side OSL). So the port extension is done in the client (`portExtend` in `lib/cable.js`): the corrected
  reflection is turned by +4 pi f tau, tau = length / (c * VF), applied to the main sweep and to Multi. Not to Cable/TDR
  (own delay maths) and not yet to CH1 (#44 stays open for S21).
- Firmware note (`lib/fwcheck.js`): only for `Board: NanoVNA-H` / `NanoVNA-H 4` (projects hugen79/NanoVNA-H and -H4, tag =
  `version` output, e.g. 1.2.50); other forks use their own numbering. GitHub API from the browser; silent on any error, never in
  the demo build. A device with 1.2.50 / build 2026-05-16 was the latest release when this was written.

## Sweep quality settings (2026-11)
- NanoVNA-H 1.2.50 shell: `bandwidth <n>` takes a divider, bandwidth = 4000 Hz / (n + 1) (3 = 1000 Hz, 399 = 10 Hz) and
  answers with a line; `smooth 0-8` and `power 0-3|255` answer with nothing; a query without argument prints the current value
  (`smooth`: `current: n`, `power`: `power: n`). A bandwidth value out of range is accepted and clamped (99999 gave 159).
  The settings are not saved to the device (no `saveconfig`).
- `readline` returned one character too many when the reply was empty (`read(0)` reads one character); fixed, since a command
  without output leaves the prompt at the start of the buffer.
- Sweep time measured on the NanoVNA-H (`scan` with data, 101 points): 0.23 s at 1000 Hz, 0.44 s at 333 Hz, 1.15 s at 100 Hz,
  3.5 s at 30 Hz, 10.2 s at 10 Hz, i.e. about 0.15 s + 101 / bandwidth. The client reads the bandwidth on connect (and when the
  dialog changes it) and lengthens the `SWEEP_MS` waits by 101 / bandwidth - 0.1 s (`sweepMs()` in `store.js`).

## Marker readout (2026-11)
- The readout (`MarkerReadout.vue`, maths in `lib/marker.js`) is computed in the client from the corrected sweep, like all other
  values; it does not use the device's `marker` command. A marker shows the nearest measured point, not an interpolation.
- Q = |X| / R. Series equivalent: R with L (X > 0) or C (X < 0). Parallel equivalent from the admittance: Rp = 1 / G, with L or C
  from the susceptance. Delta compares against the active marker; infinite values give no delta.
- Min / Max act on the first visible trace (Smith, SWR and Linear order like |Gamma|). Applies to Smith and Freq only.

## More trace formats (2026-11)
- Added Rp, Xp, Q, group delay (Freq view) and Y Smith, Polar (Smith view); R, X and |Z| were listed in the trace dialog but drew zeros.
- All values are computed in the client from the corrected sweep (`traceValues` in `lib/dsp.js`). Y Smith = Smith of the mirrored Γ (y = 1/z on the z grid). Polar is a Chart.js scatter on -1..1; it is shown instead of the Smith chart when only polar traces are visible. Group delay = -dφ/dω with unwrapped phase and central differences, in ns.
- Formats without a fixed scale share one automatic right axis (no scale dialog entry).

## Pinch zoom on the Freq chart (2026-11)
- Two fingers on the Freq chart: horizontal pinch/drag changes the sweep range, vertical pinch/drag the scale of the first trace with a fixed axis (LogMag/SWR/Phase). Maths in `lib/zoom.js`, touch events in `Graph.vue`.
- The page cannot zoom through a gesture the chart takes: `touch-action: pan-x pan-y` on the canvas drops browser pinch-zoom there, one finger still scrolls. The `viewport` meta is not used (iOS ignores `user-scalable=no`).
- The frequency range is applied on release (a new sweep per finger move would flood the NanoVNA); a hint shows the target range meanwhile. The Y scale follows live. Limits 50 kHz .. 900 MHz. Smith/Polar are not zoomed.
- Desktop: wheel / trackpad pinch (ctrl + wheel) zooms the range around the pointer (steps collected 300 ms), Shift + wheel the Y scale, mouse drag shifts (from 5 px, so plain clicks stay clicks), double click or double tap resets to 50 kHz..900 MHz and the default scale. While paused a changed range takes one sweep (`store.sweepOnce`), which ends only after a sweep delivered data.

## Modern look (2026-11)
- Fonts: system font stack (`system-ui`, SF Pro / Roboto / Segoe UI) instead of the Roboto web font from Google Fonts, so
  the text looks native on every device and loads without internet and without flash cost. Material Icons still come from Google.
- Colours: slate/indigo palette (light: `#f3f5f9` page, white cards, `#0f172a` text, `#1d4ed8` primary; dark: `#0b0f17` page,
  `#151b27` surface, `#7aa2ff` primary). Text contrast stays high for sunlight.
- Shapes: larger radii (8/12/16 px), hairline borders instead of heavy shadows, sentence-case buttons, tabs and labels (no upper case).
- Trace colours: no yellow or lime (white chip text is unreadable on them); the default trace 4 and the choices use dark orange `#f57c00`.

## scan_bin proof of concept (#49, 2026-11)
- NanoVNA-H 1.2.50 has `scan_bin <start> <stop> <points> <mask>` (listed by `help`). It blocks until the sweep is done and answers
  with `uint16 mask` (`0x80 | requested mask`), `uint16 points`, then per point `uint32 freq` (mask bit 0) and `float32 re, im` of
  channel 0 (bit 1) and channel 1 (bit 2), little endian. 101 points, mask 7 = 2061 bytes. It matches the text `scan ... 7` to the
  digit. `dev-tools/scan_bin_poc.py` reads and compares it.
- Measured (101 points, 1000 Hz bandwidth, over the WiFi bridge): today's `scan` + wait + `frequencies` + `data 0` + `data 1`
  0.89 s per full sweep (with a 0.4 s wait; the app waits `SWEEP_MS` = 0.9 s), `scan ... 7` as text 0.39 s, `scan_bin` 0.35 s.
  Five HAM bands in the Multi view: 7.1 s today, 1.0 s with `scan_bin` (mask 3).
- Most of the gain is not the binary format (text with a mask is only 0.04 s slower) but that one blocking command replaces the
  fixed `sweepMs()` wait and three round trips, and returns one consistent sweep.
- The steady Single/Freq loop (device sweeps by itself, the app reads `frequencies`/`data`) is not faster with it: reads take 0.10 s
  but show points refreshed gradually (half old, half new sweep); with `scan_bin` one read is one whole sweep, 0.35 s. Use it for
  range changes, Multi, TDR and calibration, where the waits dominate; decide for the live loop separately (smooth look vs consistent sweep).
- Implemented for Multi, Cable, TDR and the app-side calibration (`readSweep`: one `scan_bin`, mask 3 = frequencies + channel 0; falls
  back to resume + wait + `frequencies` + `data` when the firmware answers with text instead of binary). `scan_bin` leaves the
  device **paused** on the scanned range and keeps the point count it was given (101 here), so the update loop's switch back to the
  other views still sets the range and resumes (`wasMulti`). Received text is now decoded one character per byte (`bytesToString`);
  the old `TextDecoder('ascii')` is windows-1252 and turned bytes 0x80-0x9f into other characters, which also affected `capture`.
- Left on `scan`/`data`: the Single/Freq live loop (gradual refresh looks smoother) and the segment scan (existing tests pin its sequence).

## Guided calibration (#19, 2026-11)
- `CalPanel.vue` leads through Open, Short, Load (state in `calRun`: `guided`, `next`, `suspect`); only the current standard can be
  measured, the panel advances after each, **Back** repeats the previous one (not after the last: the solved bands have dropped their
  raw data), **Cancel** drops the standards measured so far. A finished calibration stays until a new set is complete.
- Plausibility check on the raw readings of all bands (`checkStandard` in `lib/oslcal.js`): open or short with a mean |reading|
  below 0.3 looks like a load; open and short closer to each other than half their mean level are the same standard; a load above
  half the level of the open/short reflects too much. A suspect result is held back (`calRun.suspect`) until **Measure again** or
  **Use anyway**. The thresholds are rules of thumb from the simulator and the NanoVNA-H's raw readings; **Use anyway** is there for
  setups that fall outside them (very lossy cable between the NanoVNA and the standards).

## Layout of the views and lost connections (2026-11)
- Single, HAM, Multi, Cable and TDR are plain HTML/SVG and now take their content height (`flex: 1 0 auto`, only without `.has-inputs`);
  the page scrolls. Before, the box was clipped to the screen (`overflow: hidden`, shrinkable), so the calibration panel under
  HAM with Return loss and R/X on could not be reached. Smith and Freq stay in a fixed box because their canvas fills its parent.
- A closed connection leaves the update loop or a calibration step waiting forever (the reply never comes). `disconnect()` now ends the
  calibration state (message "Connection to the NanoVNA lost ...") and bumps `loopGeneration`, so the loop of an earlier connection
  cannot carry on beside the new one and the buttons are not stuck disabled.
- Seen on the device: `bridge: NanoVNA gone` in `/log` while a calibration step ran (the NanoVNA left the USB bus).

## Chart full screen (2026-11)
- `ChartFrame.vue` wraps every chart: a button (inline SVG, Material "fullscreen" paths, Apache-2.0 like the Material Icons already used;
  not the icon font, which is missing without internet) puts the box over the whole window with `position: fixed`, so the chart is not
  re-created and keeps its handlers (HAM cursor, Smith/Freq zoom and pan). The browser's own Fullscreen API is requested as well where it
  exists (not on an iPhone); Esc or leaving it ends the mode.
- Charts drawn at pixel size (HAM, Cable, TDR, Multi cards) take the box size from `useFullChart` (`lib/fullchart.js`) while full; the
  canvas of Smith/Freq follows its container. Several charts in a view are full one at a time, identified by an id.

## Marker labels and Min / Max (2026-11)
- The chart labels (pinned marker labels and hover labels) get theme tokens `--tip-bg` / `--tip-border` (border and a lighter
  background); the default black box vanished on the dark chart. A marker point is a larger diamond with a ring in the text colour.
- Min / Max now make the active marker **follow** the extremum with every sweep (`marker.track`), like the cursor modes in HAM; the same
  button again stops it. The label of a following marker starts with "Min" / "Max". The extremum is searched on the first visible trace
  that the chart of the view draws (MarkerReadout gets `view`): Polar is not drawn in Freq and used to decide the search there.
- With several traces Chart.js puts a tooltip at the mean of all points, i.e. between the curves. Tooltips use the positioner
  `firstPoint` (tip on the first trace's point); the marker diamond is set on every trace's element (`_model`) in `beforeRender`, because
  the dataset arrays alone were not picked up with several traces. With several traces the title names the first trace
  ("Max CH0 swr · 250.2 MHz"): it alone decides Min / Max.

## Chrome on Android 17 and the local network (2026-11)
- Chrome (156) on an Android 17 phone failed with `ERR_TOO_MANY_RETRIES` for every address in the home network (the Feather, the
  router, a test server on the computer), while Firefox worked. Cause: Android 17 has the runtime permission
  `ACCESS_LOCAL_NETWORK` (shown as "Nearby devices"); Chrome had it only compat-revoked, Firefox had it set by the user. Not a
  firmware problem: the Feather answers Chrome-like requests correctly. Fix is on the phone (manual, section 4 and troubleshooting table); confirmed: after allowing "Nearby devices" Chrome loads the Feather.
- `dev-tools/simulator.py` now answers `scan_bin` (binary record format of the NanoVNA-H firmware), because the app reads
  Multi, Cable, TDR and the app-side calibration with it; `shots.mjs` follows the guided calibration.

## Resonance and bandwidth in HAM and Multi (2026-11)
- `lib/resonance.js`: the bandwidth is the stretch **around the minimum SWR** (not the widest stretch in the band) where SWR stays at or
  below the limit; edges are interpolated linearly between the neighbouring points, and the search runs over the whole sweep, not only
  the band (the sweep is slightly wider). `lowOpen` / `highOpen` flag a stretch that reaches the end of the sweep (shown as "≥").
- The limit (`store.swrLimit`: 1.5, 2 or 3, saved) is shared by HAM and Multi. The HAM tiles also show R + jX at the minimum.

## Reference sweep in the HAM view (2026-11)
- `lib/reference.js`, `store.hamRef`: one reference per band, kept in localStorage (frequency and SWR of each point, the calibration flag, a
  `show` flag and the time). Only HAM draws it (grey line behind the live curve, change of the minimum in the Resonance tile); Multi, Freq and
  Smith do not. Several references per band are #10 (named profiles).
- Saving is only allowed while the live sweep belongs to the band (`sweepFitsBand`: covers the band, at most 3 times its width): right after a
  switch of band or view the previous sweep (for example the full range) is still in `store.data` and was once saved by mistake.

## Foldable, movable sections in the HAM and Multi views (2026-11)
- `Fold.vue` + `store.folds` (id -> open, saved per browser): Band (the band buttons, summary = chosen band), Tools (limit, reference, cursor controls; closed by default), Results, Additional
  charts, Calibration (closed by default, forced open while a guided calibration runs). Band buttons, calibration status and the SWR chart
  stay. A closed section shows a one-line summary. HAM and Multi (Bands, Tools = SWR limit, Measurements, Calibration); the other views have far fewer elements.
- Moving: a drag handle in the header (pointer events with capture, works for touch; arrow keys on the focused handle). Order = CSS `order` of the
  section, kept in `store.order[view]` (`lib/order.js`: defaults, `normalizeOrder` drops unknown ids and appends new sections). While dragging, a section
  swaps with a neighbour once the pointer passes that neighbour's middle (stable for sections of different height). The warning banner is not a
  section and stays first. The SWR chart is a section too (`ham-swr`); the PNG export titles a chart by its own `.extra` label, not by its position.
- Header look: a thin CSS chevron at the right (down when closed, up when open) in the dim text colour instead of the Material arrow icons.
- Folded sections use `v-show`, so their charts stay mounted but have no size; `hamChartItems` leaves out charts that are not displayed.
- Calibration status in HAM: `CalStatus` shows only a missing calibration (never an OK banner, and nothing when no band is selected: that was misleading in Multi); the Calibration fold header is green instead (`tone`). `lib/calstate.js` holds the rule for both views.
  A missing calibration is an orange banner (amber for "none" and "partly" alike, also in Multi, instead of red).

## Switchable value display (2026-11)
- `store.zFormat` ('rx' | 'polar') and `store.matchMain` ('swr' | 'rl'), set in the sidebar dialog `ValueDialog.vue` (Graph > Value display...), saved per browser and validated in `loadState`. Client only, no firmware change.
- `lib/valuefmt.js`: `formatZ`, `matchValue`, `rlFromSwr`. Return loss is derived from the SWR where only the SWR is at hand (Multi cards, band edges), so all views agree.
- Applies to Freq tiles, the marker table, the HAM results, cursor and summary, and the Multi cards. Chart axes and the SWR limit stay SWR: the charts and the limit line are SWR charts by design (the RL chart is an extra chart).
- Where RL is the main value, "minimum SWR" reads "best match" (same point, the highest return loss).

## Single-frequency log and keep-screen-on (2026-11)
- The log (#13) is client only: `lib/singlelog.js` samples on every `store.dataVersion` change while the Single view is open (`store.singleActive`), only when the sweep still sits on the chosen frequency (within 1.5 kHz) and not during a calibration. Interval is the user's choice (every reading, 1 s ... 1 min).
- No fixed duration: start/stop. The limit is the point count, not time: above `LOG_MAX` (20,000) the log drops every second point and doubles the interval (`thin`), so a log can run for ever at a coarser step. The chart draws at most about two points per pixel (`downsample` keeps the lowest and highest value per bucket, so spikes stay).
- Raw values: a log point is `{ t, f, re, im }` (the reflection after app calibration and port extension, as in the other views); every format (`LOG_FORMATS`: SWR, RL, R/X, |Z|, Rp/Xp, Q, |Γ|, phase) and the CSV columns are worked out from it, so the format can change afterwards and a point is 4 numbers, not 6. Not included: group delay (needs neighbouring frequencies; the 1 kHz sweep around the chosen frequency makes it pure noise), the Smith/polar formats (loci, not values over time) and S21 (the update loop reads channel 0 only: separate issue). The first build stored SWR/RL/R/X per point; such a record is dropped on load.
- Storage: IndexedDB (`lib/logdb.js`, one record, Float64 columns, about 0.6 MB for 20,000 points), saved every 10 s while running and when the page is hidden or closed. localStorage is too small (about 5 MB as text). A restored log comes back stopped. The record is per origin: `nanovna.local` and the IP are two logs. Without IndexedDB the log stays in memory and the UI says so.
- Points live in a plain array outside the reactive store (a deep proxy over tens of thousands of points costs more than it gives); `slog.version` triggers redraws. A computed that returns the same array object does not notify its dependents: the chart works on a copy.
- Keep screen on: only the Screen Wake Lock API (`lib/wakelock.js`), asked again when the page becomes visible. It exists on secure contexts only (HTTPS, localhost); the device serves plain HTTP, so there it is usually unavailable and the menu entry says so. A silent looping video (the NoSleep trick) was offered and declined: no workaround. HTTPS on the ESP (self-signed certificate warning, flash) is not planned.
- The wake lock is released by the browser whenever the page is hidden, and a locked phone suspends the page anyway; the log then has a gap, which the chart does not join up.

## Enclosure (2026-11)
- `enclosure/make_enclosure.py` (CadQuery) builds a two-part snap-fit case; STEP and STL are generated files. The Feather is the Reverse TFT: display and the four front buttons are on the PCB underside, USB-C and the ESP32 module on top, so the window shell is the "front" and the PCB top faces the back shell.
- Board facts used (EAGLE file + Adafruit STEP): outline 50.8 x 22.86, mounting holes (2.54, 2.54), (2.54, 20.32) and (48.26, 1.84), (48.26, 20.96); display front 1.52 mm below the PCB with the active area (24.9 x 14.9) centred at x 24.8, y 11.34; USB-C sticks out 1.21 mm past the board edge; tallest top part is the battery JST at 6.37 mm.
- Parting plane at the USB-C centre height so the opening is half in each shell and no part needs support. Retention by ridges on the lip and grooves in the outer ring (wall flexes in the print plane), not by printed cantilevers (weak across layers).
- Licence: Adafruit_CAD_Parts is MIT; the model was only measured and is not stored in the repo.
- `enclosure/feather_case.sc` is the same case rebuilt as a real feature-based SolidCraft part (parameters + named sketches/features), checked against the CadQuery output: volumes agree within 0.01 %. The Python script stays the source for STEP/STL; keep both in step (same parameter names where possible). SolidCraft findings: a lip ring joined flush against the cavity wall made later cuts through it fail (`no result`), so the lip is joined as a solid first and the cavity is cut afterwards; a rectangular pattern of a groove cut was refused by the kernel, so every groove/ridge has its own sketch.
- First print (2026-11-06), findings and changes (volumes now front 2195.3, back 3611.3 mm³, CadQuery and SolidCraft agree):
  - Snap far too loose: the old ridge (0.3 mm, symmetric flanks) sat in a groove deeper than itself, so nothing held the lid. Now ridge 0.4 mm with a 45 degree retaining flank (an overhang that prints without support), groove 0.3 mm past the 0.15 mm gap, groove flank 0.05 mm lower than the ridge flank as a deliberate preload (SolidCraft interference check: 0.5 mm³, only those wedges). Tune with `ridge_h` / `groove_d`.
  - Buttons sat 0.97 mm below the outer face: each hole now has a 6.4 mm pocket 0.8 mm deep (0.4 mm floor left), so the cap is about 0.2 mm below the pocket floor. Pockets are 0.6 mm apart.
  - USB opening 13 x 8 mm box replaced by a 12.4 x 6.8 mm rounded rectangle (r 3) centred on the connector, matching a plug moulding. One cut through both shells.
  - Gap between the halves with the board in: the Adafruit model has no overlap, so this is tolerance. Measures taken: hold-down posts 0.3 mm above the PCB (was 0.1), locating pins 1.8 mm (was 2.0 in 2.2 mm holes). Photo showed the gap wider on one side at the USB end, which points at a post or pin bearing. Not yet checked on a second print.
- Second print (2026-11-06), findings and changes (volumes front 2075.3, back 3730.4 mm³; outer size 56.8 x 27.7 x 11.1 mm):
  - Snap better but still a bit soft: ridge 0.45 mm, groove 0.35 mm (`ridge_h`, `groove_d`).
  - A printed 6.4 mm hole straight through the floor works perfectly for the pill-shaped buttons (user test), so the 4.4 mm hole plus pocket is replaced by one 6.4 mm hole (`btn_d`).
  - Pressing the halves together changed the display colour: load reaches the display. Gap and pressure point to a z contact stack-up, not to the Adafruit model (no overlap). Added vertical clearance, outer faces unchanged: display to floor 0.15 -> 0.3 mm (floor 1.2 -> 1.05 mm so the button caps stay as reachable), tallest part to roof 0.38 -> 0.7 mm. Hold-down posts stay 0.3 mm above the PCB, so the only possible contact is PCB against posts, never the display. Which contact it was is not proven; if a gap remains, look for pressure marks on the display bezel and the roof.
- Third print (2026-11-06): perfect fit, user-approved ("alles einmalig"). Frozen as variant `round` (`enclosure/variants/round/`, do not change). Variant `slot` (`--variant slot`): the same case with obround button holes, 6.4 mm long along x (as the round hole) and 5.0 mm wide along y (`BTN_SLOT_W`), for looks; button access may be worse, to be tried. Only the front shell differs. Both variants exist as SolidCraft parts, `variants/<variant>/feather_case.sc` (slot: parameter `btn_slot_w`, features `BtnSlot1-4`; volume front 2098.4 mm³ against 2098.7 from CadQuery).
- Enclosure published (2026-11-06) in `enclosure/` as CC BY-SA 4.0 (user's choice, kept apart from the GPL firmware and client): both variants in all formats (STL, STEP, SolidCraft, CadQuery source) plus renders in `enclosure/images/`. Board data is only measured from Adafruit's EAGLE/STEP files, which are not redistributed.
- The `round` variant was printed successfully in both PLA and PETG (user report, 2026-11-06); the slot variant was printed too and fits perfectly (user report, 2026-11-06).
- Slot variant, reset button (2026-11-07): the fourth button (44.45, 11.43) is soldered rotated by 90 degrees against the other three, so its slot runs along y (5.0 along x, 6.4 along y). Seen in the user's photo of the print. `round` is untouched. CadQuery: `slot(..., angle=90)`; SolidCraft: `BtnSlot4Sk` redone. Volumes unchanged (front 2098.4 mm³ in SolidCraft).
- Slot variant with the reset slot turned by 90 degrees was printed and fits (user report, 2026-11-07).

## Resonance (X = 0) next to the SWR minimum in HAM (2026-11, #54)
- The lowest SWR is the best match, not resonance: they coincide only when R is close to the line impedance. HAM now names the old tile
  "Best match (min SWR)" and adds "Resonance (X = 0 Ω)": `reactanceZero` in `lib/resonance.js` takes the **rising** zero crossing of X
  (series resonance; a falling one is a parallel resonance with high R), interpolated linearly between neighbouring points inside the band,
  with R and SWR interpolated the same way. With several, the one nearest to the SWR minimum. Marked as an orange dotted line in the SWR
  and the R / X chart; the tile shows the offset to the SWR minimum.
- Deliberately **no** X tolerance window or "X bandwidth": there is no common practice for it, and the SWR limit already combines R and X.
  The usable bandwidth stays defined by the SWR limit.
- Multi (#54): every card gets a second line and an orange dotted marker for the series resonance (inside the band, else outside the band
  but in the sweep, else none), shown by a small dot (blue / orange / grey). The card colour stays on the minimum SWR only: it keeps one
  meaning (the match); a low SWR with the resonance far away is visible from the dot instead of being mixed into the colour.
- Length hint (#54): `lengthHint` in `lib/resonance.js`, a rule of thumb for simple resonant antennas (resonance inversely proportional to length):
  `|centre / f_res - 1|` in percent, "too long" below the band centre, "too short" above, nothing within 0.2 %. Target is the band centre
  (a fixed target frequency, e.g. for FT8, is not built). HAM shows it in the Resonance tile (also when the crossing is outside the band but
  inside the sweep); Multi only when the resonance is outside the band. Never in the card colour. Coils, traps and surroundings break the rule,
  so the manual calls it a guide.
