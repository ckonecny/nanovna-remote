# Status

Repo: github.com/ckonecny/nanovna-remote (public), latest release v1.1.2. Open features and bugs: GitHub issues
(CLAUDE.md rule 9). Finished work: `docs/STATUS-ARCHIVE.md`. Decisions and hardware findings: `docs/DECISIONS.md`.
This file holds only the current state and hints for the next session.

## Current state (2026-11-03)
- Solid state, everything committed and pushed; v1.1.2 is flashed on the user's Feather and tested there (installer,
  QR codes, orientation, About, return to the status screen, OTA over `/update`).
- Firmware: bridge, web app, OTA (`/update` page and `/api/ota`), calibration storage, multi-network WiFi, display UI,
  QR codes. Flash 86.8 % of the app slot (over 85 %, 207 KB free; the user decided to leave it until it gets tight).
- Web app: Single, HAM, Multi, Cable, TDR, Smith, Freq views, app-side OSL calibration, export. Live demo with a simulated
  NanoVNA: https://ckonecny.github.io/nanovna-remote/demo/ . Installer: .../install/ . Feature page: .../ .
- Release: push a tag `v*`; `release.yml` builds `-first-flash.bin`, `-update.bin`, `SHA256SUMS`, then `pages.yml` republishes
  the site with the installer manifest (about 10 min, Pages caches 10 min). Tagging needs the user's explicit OK.

## Open checks
- iPhone: does it open the setup page by itself after joining the setup WiFi (DHCP option 114)? The second QR code is the fallback.
- Android phone: flashing via the installer (Chrome) and the captive portal.
- Browser upload through `/update` works (user tested); `/update` on a phone not checked.
- Phone/device checks of older features: TDR (all sweeps, cable with a break), export on iPhone/Safari, 75 ohm cable and
  stub lengths, Multi with all-band calibration, second network/hotspot fallback, no-data banner against a real NanoVNA
  freeze, client on an iPhone, the old Feather (pre-display firmware) over WiFi.

## Next steps
- Feature backlog in GitHub issues (#6, #8-#24, #26-#29). #27 (firmware update from the web app) is partly done by the
  device's `/update` page; decide whether to close it. #29: screenshots in the manual (the user has not decided).
- OSV ignore list (`client/osv-scanner.toml`, 3 build-tool findings in vite-plugin-pwa/workbox-build) expires 2027-02-02:
  check for a workbox-build update before then and drop the entries.
- Optional: `dev-tools/screenshots/shots.mjs` could use the JS simulator (`client/src/lib/demo.js`) instead of
  `dev-tools/simulator.py`, removing the duplicate model. No flash saving (neither simulator is in the firmware).
- Known warnings: 3 `-Wmissing-field-initializers` in `web.cpp` (route table); `dns.cpp` still logs every query.

## Hints for the next session
- Chat with the user in German; repo content English (CLAUDE.md).
- OTA: `firmware/tools/ota.sh` (default host `nanovna.local`, works when the Mac is on the same WiFi). Over USB: hold D0,
  tap RESET, release D0, then `-t upload --upload-port /dev/cu.usbmodem...`.
- Logs: `http://<ip>/log`. The Feather's IP is on its display.
- Screenshots without hardware: `dev-tools/venv/bin/python dev-tools/simulator.py`, then `node shots.mjs` in
  `dev-tools/screenshots` (after `npm install`).
- The auto-mode classifier blocks `gh pr merge` and creating releases/tags without the user's explicit word: ask first.
