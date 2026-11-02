// NanoVNA Remote firmware for the ESP32-S3: WiFi, web server, NanoVNA USB bridge
// Copyright (C) 2026 Christian Konecny, SPDX-License-Identifier: GPL-3.0-or-later
#include <cstring>

#include "buttons.h"
#include "display.h"
#include "esp_log.h"
#include "esp_spiffs.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "ui.h"
#include "vna.h"
#include "web.h"
#include "wifi_mgr.h"
#include "wifi_setup.h"

static const char *TAG = "main";
void web_log_capture();

extern "C" void app_main() {
    web_log_capture();
    static const char *const reasons[] = {"unknown", "power-on", "external pin", "software", "panic (crash)", "interrupt watchdog",
                                          "task watchdog", "other watchdog", "deep sleep", "brownout", "sdio"};
    unsigned reason = (unsigned)esp_reset_reason();
    ESP_LOGW("main", "reset reason: %s", reason < sizeof reasons / sizeof *reasons ? reasons[reason] : "?");
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    esp_vfs_spiffs_conf_t fs = {};
    fs.base_path = "/spiffs";
    fs.partition_label = "storage";
    fs.max_files = 3;
    fs.format_if_mount_failed = true;
    ESP_ERROR_CHECK(esp_vfs_spiffs_register(&fs));

    buttons_start();
    display_init(ui_flipped_get());
    ui_start();

    // hold D0 (BOOT) while powering up / resetting to open the setup WiFi instead of joining a stored network
    bool force_ap = button_down(BTN_D0);
    if (force_ap) ESP_LOGI(TAG, "D0 held: opening the setup WiFi");
    wifi_mgr_start(force_ap);
    vna_usb_init();
    web_start();
}
