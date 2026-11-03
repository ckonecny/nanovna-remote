// SPDX-License-Identifier: GPL-3.0-or-later
#include "qr.h"

#include "display.h"
#include "third_party/qrcodegen/qrcodegen.h"

int qr_draw(const char *text) {
    const int max_version = 4;
    static uint8_t qr[qrcodegen_BUFFER_LEN_FOR_VERSION(max_version)];
    static uint8_t tmp[qrcodegen_BUFFER_LEN_FOR_VERSION(max_version)];
    if (!qrcodegen_encodeText(text, tmp, qr, qrcodegen_Ecc_LOW, qrcodegen_VERSION_MIN, max_version, qrcodegen_Mask_AUTO, true)) return 0;

    const int quiet = 2;
    int n = qrcodegen_getSize(qr);
    int scale = DISPLAY_H / (n + 2 * quiet);
    if (scale < 1) return 0;
    int side = (n + 2 * quiet) * scale;
    const uint16_t white = rgb565(255, 255, 255), black = rgb565(0, 0, 0);
    int y0 = (DISPLAY_H - side) / 2;
    display_fill(0, y0, side, side, white);
    for (int y = 0; y < n; y++) {
        for (int x = 0; x < n;) {
            if (!qrcodegen_getModule(qr, x, y)) {
                x++;
                continue;
            }
            int run = 1;  // one fill per run of dark modules in a row
            while (x + run < n && qrcodegen_getModule(qr, x + run, y)) run++;
            display_fill((quiet + x) * scale, y0 + (quiet + y) * scale, run * scale, scale, black);
            x += run;
        }
    }
    return side;
}
