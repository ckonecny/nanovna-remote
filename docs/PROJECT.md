# Project

NanoVNA Remote: measure antennas with a NanoVNA-H from any browser on your WiFi,
without a computer next to the antenna. An Adafruit ESP32-S3 Reverse TFT Feather
is USB host for the NanoVNA, joins WiFi and serves the web app. Target feature
set: the functions of a RigExpert Stick Pro.

```
NanoVNA-H --USB-- ESP32-S3 Feather --WiFi-- browser (all evaluation happens here)
```

## Repo layout
- `firmware/` — ESP-IDF firmware (PlatformIO, env `feather`, ESP-IDF 5.4.1,
  espressif32 6.11.0). Modules in `firmware/src/`:
  `vna` (USB host + serial bridge), `web` (HTTP server, WebSocket bridge, OTA,
  calibration storage, WiFi API/page, captive portal), `wifi_mgr` (joins a stored
  network or opens the setup WiFi), `wifi_setup` (network list in NVS, scan),
  `dns` (catch-all DNS for the captive portal), `display` (ST7789 via `esp_lcd`),
  `buttons` (debounce, short/long/double), `ui` (status screen and menus),
  `client_assets` (generated: the web app embedded as gzip, see `tools/embed_client.py`).
- `client/` — Vue 3 + Vite web app, Comlink worker, chart.js v2. App-side open/short/load
  calibration over all HAM bands (`src/lib/oslcal.js`), band definitions
  (`src/lib/bands.js`), dark mode, no-data notice.
- `dev-tools/` — Python scripts for testing the bridge from a computer.
- `manual/` — end-user manual in English and German.
- `docs/` — `STATUS.md` (current state and next steps), `STATUS-ARCHIVE.md`
  (finished items), `DECISIONS.md` (why things are built this way, hardware findings).
- `CLAUDE.md` — session-start rules; read it first.

## Hardware
- Adafruit ESP32-S3 Reverse TFT Feather (#5691): 4 MB flash, 240x135 ST7789 display,
  buttons D0 (BOOT, active low), D1 and D2 (active high). Partition table:
  `firmware/partitions.csv` (two 1.5 MB OTA slots, 0xE0000 SPIFFS `storage`).
- NanoVNA-H (VID/PID 0483:5740, text shell with `ch> ` prompt). NanoVNA V2 (04B4:0008,
  binary protocol) is passed through unchanged but not tested.

## On-device operation
D0 = up, D2 = down, D1 short = confirm, D1 long = menu / back; the bottom line of
each screen shows the hint. Holding D0 while resetting opens the setup WiFi instead of
joining a stored network. Full description: `manual/manual_en.md`.

## Versioning
Released since v1.0.0: tag `vX.Y.Z` (patch for fixes, minor for features); `release.yml` builds the GitHub release
(`-first-flash.bin`, `-update.bin`, `SHA256SUMS`) and `pages.yml` republishes the installer. The version comes from
`git describe` (`firmware/tools/version.py`). Tagging needs the user's explicit OK.

## Release consistency check (before every tag)
- `docs/STATUS.md` matches reality; finished items are in `STATUS-ARCHIVE.md`.
- `docs/DECISIONS.md` has every architecture change since the last tag.
- Both manual files describe the same, current behaviour.
- READMEs (root, `firmware/`, `client/`) quick-start steps still work.
- Licenses section and credits are current.
