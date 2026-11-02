# NanoVNA Remote — Benutzerhandbuch

## 1. Was es ist

Mit NanoVNA Remote misst du eine Antenne mit einem NanoVNA-H von jedem Handy oder Computer im WLAN aus.
Ein Adafruit ESP32-S3 Reverse TFT Feather sitzt neben dem NanoVNA (USB-Kabel), verbindet sich mit deinem WLAN
und stellt die Mess-App bereit. Du musst nichts installieren: Adresse des Feathers im Browser öffnen.

## 2. Hardware

- Adafruit ESP32-S3 Reverse TFT Feather (Produkt 5691), an dessen USB-C-Buchse der NanoVNA-H hängt
  (USB-C-auf-USB-C- oder Adapterkabel; der Feather ist der USB-Host).
- Stromversorgung des Feathers: USB-C über den NanoVNA oder ein LiPo-Akku am Feather.

## 3. Display und Tasten des Feathers

Das Display zeigt den Status: WLAN-Netz und IP-Adresse, ob ein USB-Gerät angeschlossen ist.

| Taste | Kurz drücken | Lang drücken (0,6 s) |
|---|---|---|
| D0 | hoch | — |
| D2 | runter | — |
| D1 | bestätigen / WLAN-Liste öffnen (auf dem Status-Bildschirm) | Menü (Status-Bildschirm) bzw. zurück / Optionen (in Listen) |

Die unterste Zeile jedes Bildschirms zeigt, was D1 tut. Nach 30 Sekunden ohne Tastendruck springt das Display
zurück auf den Status-Bildschirm.

**Status-Bildschirm:** D1 kurz öffnet die WLAN-Liste, D1 lang das Menü.

**WLAN-Liste:** deine gespeicherten Netze, `*` markiert das verbundene, `-` ein deaktiviertes; der letzte Eintrag
`[Setup WiFi]` öffnet das Setup-WLAN. D0/D2 wählen, D1 kurz verbindet. D1 lang öffnet die Optionen des gewählten
Netzes: Connect (verbinden), Enable/Disable (aktivieren/deaktivieren), Delete (löschen, mit Rückfrage), Back (zurück).

**Menü:** Choose WiFi (WLAN wählen), Start setup WiFi (Setup-WLAN starten), Rotate display (Bild um 180 Grad drehen,
wird gemerkt), Restart (Neustart), Back (zurück).

Die Anzeige am Gerät und die Webseiten sind englisch.

## 4. Erster Start und WLAN-Einrichtung

1. Beim ersten Start (kein Netz gespeichert) öffnet der Feather ein eigenes WLAN **NanoVNA-Remote**,
   Passwort **nanovna-remote**. Das Display zeigt Name, Passwort und Adresse.
2. Verbinde dich mit diesem WLAN und öffne **http://192.168.4.1/wifi**.
3. **Scan for networks** drücken, dein Netz antippen, Passwort eingeben und **Save** drücken. Dann **Connect**.
   Der Feather verbindet sich mit dem Netz, das Display zeigt die neue Adresse, das Handy kehrt in dein normales
   WLAN zurück. Öffne die Adresse vom Display.

Du kannst bis zu **8 Netze** speichern, zum Beispiel Heim-WLAN und einen Handy-Hotspot. Beim Start probiert der
Feather die gespeicherten Netze in Reichweite, das zuletzt benutzte zuerst. Klappt keins, öffnet er wieder das
Setup-WLAN (und sucht dort jede Minute erneut nach den gespeicherten Netzen, solange niemand damit verbunden ist).

Später wechselst du das Netz mit den Tasten (Abschnitt 3) oder auf der Seite `/wifi` (**Connect**, **On/Off**,
**Delete**). Passwörter werden nie wieder angezeigt.

**D0 halten und RESET drücken** öffnet sofort das Setup-WLAN, ohne ein gespeichertes Netz zu verwenden
(es wird nichts gelöscht).

## 5. Messen

Öffne `http://<Adresse vom Display>/` und drücke **Connect**.

- **Single** — eine Frequenz: SWR, Rückflussdämpfung, Impedanz (R + jX) und ein Diagramm um die Frequenz.
- **HAM** — Sweep über ein Amateurfunkband mit den Bandtasten; SWR-Kurve und Minimum werden angezeigt.
- **Multi** — beliebig viele Bänder antippen; jedes bekommt eine Karte mit SWR-Kurve, minimalem SWR und dem Bereich mit SWR ≤ 2. Die Bänder werden nacheinander gemessen (etwa eine Sekunde pro Band), die Aktualisierung wird also mit jedem Band langsamer. Eine Karte mit „not calibrated" zeigt unkorrigierte Werte. Die Auswahl wird gemerkt.
- Hell/Dunkel schaltest du mit der Taste in der Kopfzeile um.
- Kommen längere Zeit keine Daten, zeigt die Seite einen Hinweis (Kabel prüfen, NanoVNA neu starten).

## 6. Kalibrierung

Kalibriere einmal im Reiter **HAM** mit Open, Short und Load am Anschluss (oder am Ende des Kabels, durch das du
misst). **Measure Open**, **Measure Short**, **Measure Load** jeweils nach dem Anstecken des Normals drücken. Die
Kalibrierung gilt für **alle HAM-Bänder** und wird im Feather gespeichert, jeder Browser nutzt sie. **Reset** löscht sie.
Ohne Kalibrierung zeigt die Seite eine Warnung.

## 7. Firmware aktualisieren

Per WLAN: `firmware/tools/ota.sh <Adresse>` (baut und lädt hoch). Per USB: D0 halten, RESET tippen, dann mit
PlatformIO hochladen. Siehe `firmware/README.md`.

## 8. Fehlersuche

| Problem | Was tun |
|---|---|
| Das Display bleibt dunkel | RESET drücken. Bleibt es dunkel, per USB neu flashen. |
| Kein Setup-WLAN sichtbar | D0 halten und RESET drücken. Nach **NanoVNA-Remote** suchen (nicht nach einem älteren Namen). |
| Die Seite öffnet nicht | IP-Adresse vom Display verwenden; `nanovna.local` funktioniert nicht überall. |
| „USB: no device“ | USB-Kabel zwischen Feather und NanoVNA prüfen; der NanoVNA muss eingeschaltet sein. |
| Daten bleiben aus, NanoVNA hängt | NanoVNA neu starten (er kann nach einem Feather-Reset während einer Übertragung hängen). |
