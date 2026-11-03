# Status archive

Finished items, moved here from `docs/STATUS.md` (newest first).

## 2026-11
- Live demo (simulated NanoVNA in the browser, GitHub Pages `/demo/`), Dependabot/OSV/CodeQL cleanup, branch ruleset on `main`.
- Releases with ready-made binaries (v1.0.0 ... v1.1.2), browser installer (`/install/`, ESP Web Tools), QR codes on the display (join the setup WiFi, open the setup page, open the web app; #25), display rotated by default, version under Menu > About, DHCP captive-portal URI, display returns to the status screen once a network is joined, update page `/update` on the device (#27 in part). All tested on the device with v1.1.2.
- Return loss and R/X charts in the HAM view (#4).
- Multi-band view (#3): one card per selected band, bands swept in turn, per-band calibration applied.
- Display UI and buttons (status screen, WiFi list, menu, rotate display); English GUI texts.
- Multi-network WiFi with `/wifi` page (scan, add, enable/disable, delete, connect).
- Project docs, manual (EN + DE), GitHub repository.
- Renamed to NanoVNA Remote.
- Dark mode, large-screen layout, no-data notice.
- App-side OSL calibration over all HAM bands, stored on the ESP.
- HAM view band switch, sweep timing fixes (stale data after `resume`).
