// The three buttons of the Reverse TFT Feather (D0, D1, D2) with debouncing and click detection - SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <cstdint>

enum Button { BTN_D0, BTN_D1, BTN_D2, BTN_COUNT };
enum ButtonEvent {
    BTN_SHORT,   // pressed and released within the long-press time
    BTN_LONG,    // still held after the long-press time (reported once, while the button is down)
    BTN_DOUBLE,  // two short presses in quick succession (only for buttons enabled with buttons_enable_double)
};

struct ButtonMessage {
    Button button;
    ButtonEvent event;
};

void buttons_start();
// Blocks up to timeout_ms for the next event; false on timeout.
bool buttons_wait(ButtonMessage &msg, uint32_t timeout_ms);
// Reports quick double presses of this button. Its single presses are then delayed by the double-click window,
// so only switch it on where a screen really needs it.
void buttons_enable_double(Button b, bool on);
// Is the button held right now (without debouncing)? Used at boot.
bool button_down(Button b);
