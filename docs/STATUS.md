# Status

Repo: github.com/ckonecny/nanovna-remote (public), latest release v1.3.0. Open features and bugs: GitHub issues
(CLAUDE.md rule 9). Finished work: `docs/STATUS-ARCHIVE.md`. Decisions and hardware findings: `docs/DECISIONS.md`.
This file holds only the current state and hints for the next session.

## Current state (2026-11-05)
- Solid state, everything committed and pushed; v1.3.0 released (log over time and Keep screen on in Single, SWR limit and bandwidth,
  reference sweep, foldable sections, value display choice, "WiFi + browser" on the Feather); the feature page, README, manual and all screenshots are current.
- Firmware: bridge, web app, OTA (`/update` page and `/api/ota`), calibration storage, multi-network WiFi, display UI,
  QR codes. Flash 87.3 % of the app slot (over 85 %, about 200 KB free; the user decided to leave it until it gets tight).
- Web app: Single, HAM, Multi, Cable, TDR, Smith, Freq views, app-side OSL calibration, export. Live demo with a simulated
  NanoVNA: https://ckonecny.github.io/nanovna-remote/demo/ . Installer: .../install/ . Feature page: .../ .
- Release: push a tag `v*`; `release.yml` builds `-first-flash.bin`, `-update.bin`, `SHA256SUMS`, then `pages.yml` republishes
  the site with the installer manifest (about 10 min, Pages caches 10 min). Tagging needs the user's explicit OK.

## Open checks
- iPhone Safari in landscape: the readout overlapped the inputs and chips (user screenshot). Fixed by putting inputs and readout in one `.side-column` grid cell; Chromium checked at 844x390 and portrait, flashed; the user still has to look at it in Safari.
- Compiler warnings in `web.cpp` fixed (route helper) and `dns.cpp` no longer logs every query: flashed, device runs.
- Modern look (system font, new colours, rounded shapes; light and dark): built and flashed; not yet looked at on the phone. Yellow trace colour replaced by orange.
- Port extension (#44, S11 only), firmware note (#52) and sweep quality dialog (#45): flashed; the first two looked at by the user.
- Marker readout (#46: delta, search, range from markers, Q, series/parallel): flashed and tried on the device.
- Pinch zoom on the Freq chart (phone: tried, works live and paused). Desktop wheel/drag/double-click zoom: tried, works.
- Trace formats (#47: Rp, Xp, Q, group delay, Y Smith, Polar): built and flashed; not yet tried on the device.
- #16 touch operation, #18 light scheme and the HAM cursor (Manual/Min/Max, RL and R/X readouts at the cursor): flashed on the
  user's Feather via OTA and tried there (works). Not yet checked: light scheme outdoors in sunlight, iPhone Safari.
- iPhone: does it open the setup page by itself after joining the setup WiFi (DHCP option 114)? The second QR code is the fallback.
- Android phone: flashing via the installer (Chrome) and the captive portal.
- Browser upload through `/update` works (user tested); `/update` on a phone not checked.
- Phone/device checks of older features: TDR (all sweeps, cable with a break), export on iPhone/Safari, 75 ohm cable and
  stub lengths, Multi with all-band calibration, second network/hotspot fallback, no-data banner against a real NanoVNA
  freeze, client on an iPhone, the old Feather (pre-display firmware) over WiFi.

## Next steps
- #54 resonance (X = 0) in HAM and Multi (Multi: second line and marker per card, colour unchanged; length hint "antenna about x % too long/short" in HAM, in Multi only outside the band): built, unit-tested (`reactanceZero`), checked in the demo (tile, marker lines in the SWR and R / X chart), manual EN + DE and DECISIONS updated. Committed (`4caa464`). Flashed via OTA (flash 87.9 %, over 85 %). Open: try it on the real antenna; the HAM screenshots in `dev-tools/screenshots/` and the feature page still show the old tile name if they include it.
- Enclosure (`enclosure/`, side task): only the slot variant is left (round removed 2026-11-07). The printed slot case fits; the new version has 2 mm chamfers on the outer edge of both shells (no window chamfer): not printed yet, not committed. Open: print it, check the window against the real active area.
- Marker labels in the dark scheme (border, lighter background, ring around the point) and Min/Max following the extremum with a
  "Min"/"Max" label: built, checked in the demo (dark and light), flashed. With several traces the tooltip sits on the first
  trace and its title names it ("Max CH0 swr · 250.2 MHz"). Not looked at on the iPhone.
- Code review (2026-11-03) of the 1.2 changes: findings fixed and flashed (full-screen race and size timing, Min/Max released
  when the view goes away, marker look via Chart.js scriptable options instead of `_model`, per-chart height in HAM, tests
  for follow/retrack).  Full screen on a phone: title and button moved out of the rounded corners (checked on an iPhone, both orientations).
- Chart full screen (button top right of every chart): built, tested in the demo (desktop, 390x800), flashed. Not yet looked at on
  the iPhone (Safari has no Fullscreen API: the fixed box covers the page but not the address bar).
- Open: the NanoVNA dropped off USB once while the Short step of the calibration ran (`NanoVNA gone` in `/log`). Cause unknown
  (static when attaching the standard? USB power?); watch for it. The app now recovers from a lost connection (DECISIONS).
- #19 guided calibration: built, tested in the demo (right standards and the two wrong-standard warnings) and flashed. Open check:
  the plausibility thresholds against real standards on the device (a false alarm would show as the "Use anyway" prompt).
- #49 `scan_bin`: in the app for Multi, Cable, TDR and the app-side calibration (`readSweep` in `store.js`, `scanBin` in
  `nanovna.js`), flashed and checked on the device (Multi, TDR, back to Freq). Single/Freq live loop and the segment scan are
  unchanged on purpose (see DECISIONS). Committed.
- #44 port extension: done for S11 in metres only; open: input in ns, S21. Issue stays open (user to decide).
- Feature backlog in GitHub issues (#6, #8, #10, #14, #15, #17, #21-#24, #26, #28, #29, #44, #45, #47-#51, #53 (#46, #47 done); #16 and #18 are closed by the touch/theme commit). #27 is closed (device page `/update`). #29: screenshots in the manual (the user has not decided).
- OSV ignore list (`client/osv-scanner.toml`, 3 build-tool findings in vite-plugin-pwa/workbox-build) expires 2027-02-02:
  check for a workbox-build update before then and drop the entries.
- Optional: `dev-tools/screenshots/shots.mjs` could use the JS simulator (`client/src/lib/demo.js`) instead of
  `dev-tools/simulator.py`, removing the duplicate model. No flash saving (neither simulator is in the firmware).

## Hints for the next session
- Chat with the user in German; repo content English (CLAUDE.md).
- OTA: `firmware/tools/ota.sh` (default host `nanovna.local`, works when the Mac is on the same WiFi). Over USB: hold D0,
  tap RESET, release D0, then `-t upload --upload-port /dev/cu.usbmodem...`.
- Logs: `http://<ip>/log`. The Feather's IP is on its display.
- Screenshots without hardware: `dev-tools/venv/bin/python dev-tools/simulator.py`, then `node shots.mjs` in
  `dev-tools/screenshots` (after `npm install`).
- The auto-mode classifier blocks `gh pr merge` and creating releases/tags without the user's explicit word: ask first.
