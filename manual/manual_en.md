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

<img src="../site/img/feather-status.jpg" width="320" alt="The status screen"> <img src="../site/img/feather-menu.jpg" width="320" alt="The menu">

<sub>The status screen (network name and address blurred) and the menu.</sub>

| Button | Short press | Long press (0.6 s) |
|---|---|---|
| D0 | up | — |
| D2 | down | — |
| D1 | confirm / open the WiFi list (on the status screen) | menu (status screen) or back / options (in lists) |

The bottom line of every screen shows what D1 does. After 30 seconds without a key the display
returns to the status screen.

**Status screen:** D1 short opens the WiFi list; D1 long opens the menu; D2 shows a **QR code** (see below).

**QR code:** while the setup WiFi is open the code joins that WiFi (point the phone's camera at it and confirm), and the setup
page then opens by itself on most phones. While the Feather is on your network the code opens the web app. The code
appears by itself when the setup WiFi opens; any key closes it. It is small, hold the phone 10 to 15 cm from the display.

**WiFi list:** your saved networks, `*` marks the connected one and `-` a disabled one; the last entry
`[Setup WiFi]` opens the setup WiFi. D0/D2 select, D1 short connects. D1 long opens the options of the
selected network: Connect, Enable/Disable, Delete (with a question), Back.

**Menu:** Choose WiFi, Start setup WiFi, Rotate display (turns the picture by 180 degrees, remembered),
Restart, Back.

## 4. First start and WiFi setup

1. On first start (no saved network) the Feather opens its own WiFi **NanoVNA-Remote**,
   password **nanovna-remote**. The display shows a **QR code** for it.
2. Scan the QR code with the phone's camera and join the WiFi; the setup page opens by itself. If it does not, or on a
   computer, join the WiFi by hand (name and password are on the status screen, D2 shows the code again) and open
   **http://192.168.4.1/wifi**.
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

## 5. The web app

Open `http://<address on the display>/` and press **Connect**. The app runs in the browser; the Feather only passes the
data on.

The screenshots in this manual show simulated values, not real measurements.

You can try the app without hardware: the [live demo](https://ckonecny.github.io/nanovna-remote/demo/) is the same app with a
simulated NanoVNA. Press **connect**, and choose in the bar at the top what is attached (antenna, open / short / load
standard, cable). The calibration works on the simulated standards too. The values are modelled, not measured, and the
calibration stays in your browser only.

### 5.1 Overview

**Header.** Left: the menu button (opens the side menu, 5.9). Then the light/dark switch and, depending on the state,
**connect** / **connecting...**. When connected, the button next to it controls the measurement: **Pause** / **Resume** for
sweeps of up to 101 points (the app measures continuously), **Update** / **Stop** for longer sweeps (see *Resolution* in 5.9;
the button shows the progress in segments).

**Tabs.** Seven views: **Single**, **HAM**, **Multi**, **Cable**, **Smith**, **Freq**, **TDR**.

| Tab | Use it to |
|---|---|
| Single | read SWR and impedance at one frequency |
| HAM | sweep one amateur band and find the best frequency |
| Multi | compare several bands at once |
| Cable | measure length, velocity factor, loss and characteristic impedance of a coax cable; stub lengths |
| Smith | see a sweep of your own range in a Smith chart |
| Freq | see a sweep of your own range as curves over frequency |
| TDR | find where along a cable the signal is reflected |

If no data arrives for a while the page shows a notice (check the cable, restart the NanoVNA).

### 5.2 Single

<img src="../site/img/phone-single.png" width="280" alt="Single">

One frequency: tap the frequency to change it (keypad, see 5.7). The tiles show SWR, return loss, |Z|, R, X, the reactance as
inductance or capacitance (series), |Γ| and the phase. A chart around the frequency is shown as well.

### 5.3 HAM

<img src="../site/img/phone-ham-extras.png" width="280" alt="HAM view">

Sweep over an amateur band: pick the band with the band buttons. The SWR curve shows the minimum, and the tiles name the minimum
SWR with its frequency, the range where SWR ≤ 2 and the SWR at both band edges. Tap or click into the chart to place a cursor;
the tile **Cursor** then shows SWR, R and X at that frequency. Under the chart, **Also show** adds a return loss chart (dB) and an
R / X chart (resistance and reactance in Ω); both share the frequency axis and the cursor of the SWR chart. The choice is
remembered. The calibration panel at the bottom is described in chapter 6.

### 5.4 Multi

<img src="../site/img/phone-multi.png" width="280" alt="Multi view">

Tick any number of bands; each gets a card with its SWR curve, minimum SWR and the range where SWR ≤ 2. The bands are swept one
after another (about one second each), so the refresh slows down with every band added. Every card says whether its band is
"calibrated" (green) or "not calibrated" (red, uncorrected values), and a banner at the top summarises the selection. The
calibration panel sits at the bottom of the Multi view as well. The selection is remembered.

### 5.5 Cable

<img src="../site/img/phone-cable.png" width="280" alt="Cable view">

Measures a coax cable. Connect it to the NanoVNA and leave the far end open or shorted. Pick the sweep (1–30 MHz for cables up to
about 150 m, 1–200 MHz for up to about 20 m) and what to measure: the **length** (enter the velocity factor or pick a typical cable
type) or the **velocity factor** (enter the known length). The view shows the result, the one-way delay, whether the phase is a
straight line (a plausibility check) and the one-way loss at three frequencies (dB per 100 m from 1 m of cable on). First press
**Zero: nothing attached** with the cable removed: the NanoVNA has a delay of its own that would otherwise be added to the length;
the zero is remembered per sweep. A cable longer than the limit of the sweep shows a wrong, shorter length without any warning.

Below the results, **Characteristic impedance** needs two measurements of the same cable with the same sweep: press **Measure
open** with the far end open and **Measure short** with it shorted (in either order; **Clear** starts again). The impedance is the
geometric mean of the two readings, taken over the frequencies where both are well measurable; a cable that is too short for the
sweep gives no result (use 1–200 MHz). The value depends on the NanoVNA's own calibration for the sweep. **Cut and stub lengths**
works out, for a frequency, the quarter and half wavelength of the cable (using the velocity factor above) and the shortest shorted
or open stub that shows a given reactance (positive inductive, negative capacitive) on a cable of the given impedance; **Use
measured impedance** copies the result of the measurement.

### 5.6 TDR

<img src="../site/img/phone-tdr.png" width="280" alt="TDR view with a fault at 12 m">

Finds where along a cable the signal is reflected (a break, a short, water). Pick the sweep for the cable length (short:
resolution about 0.5 m, range 33 m; medium: about 1.5 m, 100 m; long: about 5 m, 330 m, at velocity factor 0.66) and set the
velocity factor (typical values by cable type; measure yours in **Cable**). The chart shows reflections over distance: up means
open or higher impedance, down means short or lower impedance; the peak at 0 m is the connector. The marker names the strongest
reflection beyond it, if it is larger than 0.05. Two reflections closer than the resolution blur into one.

### 5.7 Smith and Freq: your own sweep

<img src="../site/img/phone-smith.png" width="280" alt="Smith view">

**Smith** shows the reflection in a Smith chart, **Freq** shows curves over frequency. Both sweep the range you enter above the
chart:

- **Start/Stop** or **Center/Span**: tap a field to open the keypad. Type the number and finish with the unit key **G**, **M**,
  **k** or **x1** (Hz); that key also confirms the input. The backspace key deletes the last digit.
- **Trace chips** (for example `CH0 LogMag`): every chip is one curve; the colour shows whether it is visible. Tap a chip to open
  its settings (5.8).
- Markers and scales (5.9) apply to these two views.

The app-side calibration (chapter 6) corrects these views only inside the HAM bands; everywhere else the readings are
uncorrected.

### 5.8 Traces

A trace is one curve in the **Freq** or **Smith** view. In the settings you choose:

- **Show**: show or hide the curve.
- **Channel**: CH0 Reflect (the reflection at the measurement port) or CH1 Through (the transmission between the two ports).
- **Trace Format**: Smith Chart, LogMag, Phase, SWR, Linear, Real, Imag, R, X or |Z|.
- **Trace Type**: Clear (live), Freeze (hold the current curve), Max Hold, Min Hold, Video Average or Power Average (with the
  **Average Count**).
- **Change Color** and the bin symbol to delete the trace.

**Add Trace** in the side menu creates a new one.

### 5.9 The side menu

<img src="../site/img/phone-menu.png" width="280" alt="The side menu">

The menu button opens it. Entries that need a connection are greyed out until you are connected.

**Graph**
- **Setup Markers**: lists the markers; the tick shows or hides one, the bin deletes it, **Add Marker** asks for a frequency.
  Markers appear as labels in the **Smith** and **Freq** charts.
- **Setup Scales**: minimum and maximum of the vertical axes for LogMag (dB), SWR, Phase (°) and Linear.
- **Add Trace**: see 5.8.
- **Resolution...**: the number of 101-point segments per sweep. 1 means 101 points; more segments give a finer sweep but take
  longer, and the header button changes to Update/Stop.

**Device**
- **Connect** / **Disconnect**.
- **Connection Type**: normally *Auto*. *WiFi bridge (ESP32)* connects through the Feather; the field below takes its name or
  address (`nanovna.local` or the IP address). *WebSerial* and *WebUSB* connect to a NanoVNA plugged into the computer itself.

**Save**
- **Save As .s1p** saves the sweep as a Touchstone file; in **Multi** it saves one file per band. **Save As .s2p** saves both
  channels (channel 1 is only measured while a CH1 trace is shown, otherwise it is zero).
- **Save Charts As .png** saves all charts of the HAM or Multi view as one picture; in **Smith** and **Freq** the entry saves
  that chart. HAM and Multi files are named after band and date, for example `20m-20261102.s1p`, all others after date and
  time (`nanovna-20261102-143000.s1p`). The values are saved as displayed, with the app-side calibration applied.
- **Capture Device**: shows the NanoVNA's own screen. **Refresh** takes a new picture, **Download** saves it.

**State**
- **Calibrate...**: calibration of the NanoVNA itself (Reset, Open, Short, Load, Thru, Done and save into slot 0–4). For
  measuring with this app use the app-side calibration (chapter 6) instead.
- **Recall 0–4**: loads a state saved in the NanoVNA (sweep range and its calibration).

**About**: **Version** (version information) and **Quit** (closes the window). At the bottom the side menu holds a log of the
connection for troubleshooting (**Clear Logs**).

## 6. Calibration

<img src="../site/img/phone-calibration.png" width="280" alt="The calibration panel">

The app corrects the readings itself with an open/short/load calibration of **all HAM bands**; the NanoVNA's own calibration is
switched off while it is in use.

Calibrate once, on the **HAM** or **Multi** tab, with the open, short and load standards at the connector (or at the
end of the cable you measure through). Press **Measure Open**, **Measure Short**, **Measure Load**, each
after attaching the standard. A band's correction is only computed once all three standards have been measured, so do not press
a button before the right standard is attached. The calibration is stored in the Feather, so every
browser uses it. **Reset** deletes it. Without a calibration the page shows a warning; HAM and Multi show for each band whether
it is calibrated.

## 7. Updating the firmware

The easiest way is the **[browser installer](https://ckonecny.github.io/nanovna-remote/install/)** (Chrome or Edge on a
computer): put the Feather in the bootloader (hold D0, tap RESET, release D0), click **Connect**, pick the port and choose **Install**. It
installs the latest release and, like the first-flash file below, clears the stored WiFi networks. The calibration stays.

Every [release](https://github.com/ckonecny/nanovna-remote/releases) has two ready-made files:

- **`...-first-flash.bin`** for the first installation (or to start over) over USB: hold D0, tap RESET, release D0, then
  `pip install esptool` and `esptool.py --chip esp32s3 write_flash 0x0 <file>`. This also clears the stored WiFi networks.
- **`...-update.bin`** for later updates over WiFi, no cable needed:
  `curl --data-binary @<file> http://<address>/api/ota`. The Feather restarts; the WiFi networks and the calibration stay.

If you build the firmware yourself: `firmware/tools/ota.sh <address>` builds and uploads over WiFi; over USB upload with
PlatformIO. See `firmware/README.md`.

## 8. Troubleshooting

| Problem | What to do |
|---|---|
| The display stays dark | Press RESET. If it stays dark, reflash over USB. |
| No setup WiFi visible | Hold D0 while pressing RESET. Look for **NanoVNA-Remote** (not an older name). |
| The page does not open | Use the IP address from the display; `nanovna.local` does not work everywhere. |
| "USB: no device" | Check the USB cable between Feather and NanoVNA; the NanoVNA must be switched on. |
| Data stops, NanoVNA frozen | Restart the NanoVNA (it can hang after a Feather reset during a transfer). |
