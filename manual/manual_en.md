# NanoVNA Remote — User Manual

## 1. What it is

NanoVNA Remote lets you measure an antenna with a NanoVNA-H from any phone or computer on your WiFi.
An Adafruit ESP32-S3 Reverse TFT Feather sits next to the NanoVNA (USB cable), joins your WiFi and
serves the measurement app. You do not install anything: open the Feather's address in a browser.

## 2. Hardware

- Adafruit ESP32-S3 Reverse TFT Feather (product 5691) with a NanoVNA-H connected to its USB-C port
  (use a USB-C to USB-C or adapter cable; the Feather is the USB host).
- Power for the Feather: USB-C power via the NanoVNA, or a LiPo battery on the Feather.

## 3. The Feather's display and buttons

The display shows the status: WiFi network and IP address, whether a USB device is plugged in.

| Button | Short press | Long press (0.6 s) |
|---|---|---|
| D0 | up | — |
| D2 | down | — |
| D1 | confirm / open the WiFi list (on the status screen) | menu (status screen) or back / options (in lists) |

The bottom line of every screen shows what D1 does. After 30 seconds without a key the display
returns to the status screen.

**Status screen:** D1 short opens the WiFi list; D1 long opens the menu.

**WiFi list:** your saved networks, `*` marks the connected one and `-` a disabled one; the last entry
`[Setup WiFi]` opens the setup WiFi. D0/D2 select, D1 short connects. D1 long opens the options of the
selected network: Connect, Enable/Disable, Delete (with a question), Back.

**Menu:** Choose WiFi, Start setup WiFi, Rotate display (turns the picture by 180 degrees, remembered),
Restart, Back.

## 4. First start and WiFi setup

1. On first start (no saved network) the Feather opens its own WiFi **NanoVNA-Remote**,
   password **nanovna-remote**. The display shows the name, password and address.
2. Join that WiFi with your phone or computer and open **http://192.168.4.1/wifi**.
3. Press **Scan for networks**, tap your network, enter its password and press **Save**. Press
   **Connect**. The Feather joins that network and the display shows the new address; the phone returns to
   your normal WiFi. Open the address shown on the display.

You can save up to **8 networks**, for example your home WiFi and a phone hotspot. On start the Feather
tries the saved networks that are in range, the one used last first. If none works it opens the setup WiFi
again (and looks for the saved networks again every minute while nobody is connected to it).

To switch networks later use the buttons (section 3) or the `/wifi` page (**Connect**, **On/Off**, **Delete**).
Passwords are never shown again.

**Hold D0 while pressing RESET** to open the setup WiFi right away without joining a saved network
(nothing is deleted).

## 5. Measuring

Open `http://<address on the display>/` and press **Connect**.

- **Single** — one frequency: SWR, return loss, impedance (R + jX), plus a chart around the frequency.
- **HAM** — sweep over an amateur band with the band buttons; the SWR curve and the minimum are shown.
- **Multi** — tick any number of bands; each gets a card with its SWR curve, minimum SWR and the range where SWR ≤ 2. The bands are swept one after another (about one second each), so the refresh slows down with every band added. A card marked "not calibrated" shows uncorrected values. The selection is remembered.
- Switch light/dark mode with the button in the header.
- If no data arrives for a while the page shows a notice (check the cable, restart the NanoVNA).

## 6. Calibration

Calibrate once, on the **HAM** tab, with the open, short and load standards at the connector (or at the
end of the cable you measure through). Press **Measure Open**, **Measure Short**, **Measure Load**, each
after attaching the standard. The calibration covers **all HAM bands** and is stored in the Feather, so every
browser uses it. **Reset** deletes it. Without a calibration the page shows a warning.

## 7. Updating the firmware

Over WiFi: `firmware/tools/ota.sh <address>` (builds and uploads). Over USB: hold D0, tap RESET, then upload
with PlatformIO. See `firmware/README.md`.

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| The display stays dark | Press RESET. If it stays dark, reflash over USB. |
| No setup WiFi visible | Hold D0 while pressing RESET. Look for **NanoVNA-Remote** (not an older name). |
| The page does not open | Use the IP address from the display; `nanovna.local` does not work everywhere. |
| "USB: no device" | Check the USB cable between Feather and NanoVNA; the NanoVNA must be switched on. |
| Data stops, NanoVNA frozen | Restart the NanoVNA (it can hang after a Feather reset during a transfer). |
