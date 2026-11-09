// ST7789 display of the Adafruit ESP32-S3 Reverse TFT Feather (240x135, landscape) - SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <cstdint>

#define DISPLAY_W 240
#define DISPLAY_H 135
#define GLYPH_W 6  // 5x7 font plus one column of spacing
#define GLYPH_H 8

constexpr uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) { return (uint16_t)(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)); }

void display_init(bool flipped);
// backlight in percent of full power (PWM duty), 0 = off
void display_backlight(int percent);
void display_set_flipped(bool flipped);  // turns the picture by 180 degrees
void display_fill(int x, int y, int w, int h, uint16_t color);
// draws one line of text (opaque background); returns the width in pixels. scale 1 = 6x8 px per character, 2 = 12x16
int display_text(int x, int y, const char *s, uint16_t fg, uint16_t bg, int scale = 2);
