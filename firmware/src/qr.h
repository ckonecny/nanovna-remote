// Draws a QR code on the display - SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

// Black modules on a white square with a 2-module quiet zone, left edge at x = 0, as large as the display height allows.
// Returns the width of the drawn square in pixels, or 0 if the text does not fit (QR version 1 to 4, error correction L).
int qr_draw(const char *text);
