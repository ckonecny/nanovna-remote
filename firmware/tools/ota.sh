#!/bin/sh
# Firmware update over WiFi: builds the feather env and uploads it to the device (no USB cable needed).
# usage: tools/ota.sh [host]      default host: nanovna.local
cd "$(dirname "$0")/.." || exit 1
HOST=${1:-nanovna.local}
python3 -m platformio run -e feather || exit 1
curl --fail --max-time 120 --data-binary @.pio/build/feather/firmware.bin "http://$HOST/api/ota" && echo " - updating, device restarts"
