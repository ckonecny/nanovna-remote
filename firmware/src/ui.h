// On-device user interface: status screen and menus on the Feather's display, driven by its three buttons.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

// Operation: D0 = up, D2 = down, D1 short = confirm, D1 long = menu / back (the screen's hint line says which).
void ui_start();
