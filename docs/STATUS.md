# Status

Repo: ckonecny/nanovna-remote (private). Not versioned yet.
Open features and bugs: GitHub issues (CLAUDE.md rule 9). Finished work:
`docs/STATUS-ARCHIVE.md`. This file holds only the current state and hints for the next session.

## Current state (2026-11-02)
- Firmware on the Feather: bridge, web app, OTA, calibration storage, multi-network WiFi,
  display status screen and menus (English), buttons. Flash 85 % of the app slot.
- Web app: Single frequency, HAM and Multi views with app-side OSL calibration over all bands,
  dark mode, no-data notice. 107 client tests pass.
- Tested on the new Feather (display, buttons, WiFi list, `/wifi` page).

- QR code on the display (D2, and automatic in setup mode): built (86.5 % flash), not yet seen on the device or scanned. Closes #25 once checked.
- Browser installer (`site/install/`, ESP Web Tools): written, not yet flashed from the browser on a real Feather.
- Release workflow (`release.yml`, tag `v*`) written; first release (tag) and a flash test of the first-flash image are open.
- Live demo: `npm run build:demo`, published to `/demo/` of the Pages site by `pages.yml` (see DECISIONS).
- Simulator and screenshots: `dev-tools/simulator.py` + `dev-tools/screenshots/shots.mjs` (see DECISIONS); the manual has
  screenshots and `site/` holds the feature page (not published yet: GitHub Pages must be enabled, repo must be public).

## Phone/device checks still open
- TDR view (#2): confirmed working on a real cable by the user (no numbers recorded). Not yet checked: all three sweeps, a cable with a break, accuracy at 0 m.
- Export in HAM and Multi (#7, side menu Save section): .s1p (band-date file names, one per band in Multi) and PNG of the SVG charts; checked in the browser against the device (files created, PNG rendered correctly). Not checked: iPhone/Safari download behaviour, many downloads in a row.
- Cable view (#1): length/velocity factor/loss confirmed working on a real cable by the user (no numbers recorded). Characteristic impedance (open + short) and cut/stub lengths added; impedance confirmed on a real 50 ohm cable (52.3 ohm). Not checked on hardware: 75 ohm cable, stub lengths (maths covered by tests).
- Multi view: checked uncalibrated against the NanoVNA; still to check with the calibration of all bands.
- Second network (hotspot): join, switch with the buttons, fall back to the setup WiFi when
  a network is out of range; the 60 s retry of stored networks in the setup WiFi.
- Switching networks from the `/wifi` page while connected over the same WiFi.
- No-data banner against a real NanoVNA freeze.
- Client on an iPhone.
- The old Feather (still on the pre-display firmware): update over WiFi.

## Next steps
OSV ignore list (`client/osv-scanner.toml`, 3 build-tool findings in vite-plugin-pwa/workbox-build) expires 2027-02-02: check for a workbox-build update before then and drop the entries.
Feature backlog (Stick Pro parity) is in GitHub issues: accuracy check of the calibration against an independent mismatch (#6; kit-only check done, see DECISIONS), single-stub matching (#8).

## Hints for the next session
- Screenshots without hardware: `dev-tools/venv/bin/python dev-tools/simulator.py`, then `node shots.mjs` in `dev-tools/screenshots` (after `npm install`).
- Logs: `http://<ip>/log`. The Feather's IP is on its display.
- Over USB: hold D0, tap RESET, then `-t upload --upload-port /dev/cu.usbmodem...`.
- `dns.cpp` still logs every query (diagnostic); remove when no longer needed.
