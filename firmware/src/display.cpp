// SPDX-License-Identifier: GPL-3.0-or-later
#include "display.h"

#include <algorithm>
#include <cstring>

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "font5x7.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "display";

// wiring of the Reverse TFT Feather
#define PIN_MOSI 35
#define PIN_SCLK 36
#define PIN_CS 42
#define PIN_DC 40
#define PIN_RST 41
#define PIN_BACKLIGHT 45
#define PIN_TFT_POWER 7

static esp_lcd_panel_handle_t panel;
static SemaphoreHandle_t done;
static uint16_t *buf;  // DMA buffer, big enough for 16 full lines
static const int BUF_PIXELS = DISPLAY_W * 16;

static bool on_done(esp_lcd_panel_io_handle_t, esp_lcd_panel_io_event_data_t *, void *) {
    BaseType_t woken = pdFALSE;
    xSemaphoreGiveFromISR(done, &woken);
    return woken == pdTRUE;
}

static void blit(int x, int y, int w, int h) {  // sends buf (already byte swapped) and waits for the DMA
    esp_lcd_panel_draw_bitmap(panel, x, y, x + w, y + h, buf);
    xSemaphoreTake(done, pdMS_TO_TICKS(200));
}

void display_set_flipped(bool flipped) {
    // the panel's 135x240 window sits at column 52/53 and row 40 of the controller's RAM (the exact column depends on the
    // mirroring); with 52 in the turned position the last picture line showed unwritten RAM
    esp_lcd_panel_swap_xy(panel, true);
    esp_lcd_panel_mirror(panel, flipped, !flipped);
    esp_lcd_panel_set_gap(panel, 40, 53);
}

void display_init(bool flipped) {
    gpio_config_t out = {};
    out.pin_bit_mask = (1ULL << PIN_TFT_POWER) | (1ULL << PIN_BACKLIGHT);
    out.mode = GPIO_MODE_OUTPUT;
    gpio_config(&out);
    gpio_set_level((gpio_num_t)PIN_TFT_POWER, 1);  // powers the display and the Stemma QT connector
    gpio_set_level((gpio_num_t)PIN_BACKLIGHT, 0);

    done = xSemaphoreCreateBinary();
    buf = (uint16_t *)heap_caps_malloc(BUF_PIXELS * 2, MALLOC_CAP_DMA);

    spi_bus_config_t bus = {};
    bus.mosi_io_num = PIN_MOSI;
    bus.miso_io_num = -1;
    bus.sclk_io_num = PIN_SCLK;
    bus.quadwp_io_num = -1;
    bus.quadhd_io_num = -1;
    bus.max_transfer_sz = BUF_PIXELS * 2;
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io = nullptr;
    esp_lcd_panel_io_spi_config_t io_cfg = {};
    io_cfg.cs_gpio_num = PIN_CS;
    io_cfg.dc_gpio_num = PIN_DC;
    io_cfg.spi_mode = 0;
    io_cfg.pclk_hz = 40 * 1000 * 1000;
    io_cfg.trans_queue_depth = 4;
    io_cfg.lcd_cmd_bits = 8;
    io_cfg.lcd_param_bits = 8;
    io_cfg.on_color_trans_done = on_done;
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_cfg, &io));

    esp_lcd_panel_dev_config_t panel_cfg = {};
    panel_cfg.reset_gpio_num = PIN_RST;
    panel_cfg.rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB;
    panel_cfg.bits_per_pixel = 16;
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io, &panel_cfg, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, true));  // IPS panel
    display_set_flipped(flipped);
    display_fill(0, 0, DISPLAY_W, DISPLAY_H, 0);
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
    gpio_set_level((gpio_num_t)PIN_BACKLIGHT, 1);
    ESP_LOGI(TAG, "display ready");
}

void display_fill(int x, int y, int w, int h, uint16_t color) {
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    w = std::min(w, DISPLAY_W - x);
    h = std::min(h, DISPLAY_H - y);
    if (w <= 0 || h <= 0) return;
    uint16_t c = __builtin_bswap16(color);
    int rows = std::min(h, BUF_PIXELS / w);
    std::fill(buf, buf + w * rows, c);
    for (int done_rows = 0; done_rows < h; done_rows += rows) blit(x, y + done_rows, w, std::min(rows, h - done_rows));
}

int display_text(int x, int y, const char *s, uint16_t fg, uint16_t bg, int scale) {
    int cell_w = GLYPH_W * scale, cell_h = GLYPH_H * scale;
    int n = std::min<int>(strlen(s), (DISPLAY_W - x) / cell_w);
    if (n <= 0 || cell_h > 16 || y < 0 || y + cell_h > DISPLAY_H) return 0;
    int w = n * cell_w;
    uint16_t f = __builtin_bswap16(fg), b = __builtin_bswap16(bg);
    for (int row = 0; row < cell_h; row++) {
        int glyph_row = row / scale;
        for (int i = 0; i < n; i++) {
            unsigned char ch = s[i];
            const uint8_t *g = font5x7[ch >= 32 && ch < 127 ? ch - 32 : '?' - 32];
            for (int col = 0; col < GLYPH_W; col++) {
                bool on = col < 5 && glyph_row < 8 && (g[col] >> glyph_row & 1);
                std::fill_n(buf + row * w + i * cell_w + col * scale, scale, on ? f : b);
            }
        }
    }
    blit(x, y, w, cell_h);
    return w;
}
