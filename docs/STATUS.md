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

## Phone/device checks still open
- Multi view: checked uncalibrated against the NanoVNA; still to check with the calibration of all bands.
- Second network (hotspot): join, switch with the buttons, fall back to the setup WiFi when
  a network is out of range; the 60 s retry of stored networks in the setup WiFi.
- Switching networks from the `/wifi` page while connected over the same WiFi.
- No-data banner against a real NanoVNA freeze.
- Client on an iPhone.
- The old Feather (still on the pre-display firmware): update over WiFi.

## Next steps
Feature backlog (Stick Pro parity) is in GitHub issues: cable tools, TDR, multi-band view,
export buttons in HAM/Multi, accuracy check of the calibration (issues #1, #2, #6, #7).

## Hints for the next session
- Logs: `http://<ip>/log`. The Feather's IP is on its display.
- Over USB: hold D0, tap RESET, then `-t upload --upload-port /dev/cu.usbmodem...`.
- `dns.cpp` still logs every query (diagnostic); remove when no longer needed.
