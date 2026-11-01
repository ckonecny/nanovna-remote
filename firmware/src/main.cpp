// NanoVNA Remote firmware for the ESP32-S3: WiFi, web server, NanoVNA USB bridge
// Copyright (C) 2026 Andreas Karpf, SPDX-License-Identifier: GPL-3.0-or-later
#include <cstring>

#include "dns.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_spiffs.h"
#include "esp_system.h"
#include "esp_mac.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "mdns.h"
#include "driver/gpio.h"
#include "wifi_setup.h"
#include "nvs_flash.h"
#include "vna.h"
#include "web.h"

static const char *TAG = "main";
extern bool web_captive_portal;
void web_log_capture();

// The phone joins this WiFi network directly, then opens http://192.168.4.1/
#define AP_SSID "NanoVNA-Remote"
#define AP_PASSWORD "nanovna-remote"  // at least 8 characters; change it before using the device anywhere public

static void on_ap_event(void *, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) {
        auto *e = (wifi_event_ap_staconnected_t *)data;
        ESP_LOGI(TAG, "phone joined: " MACSTR, MAC2STR(e->mac));
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED) {
        ESP_LOGI(TAG, "phone left");
    } else if (base == IP_EVENT && id == IP_EVENT_AP_STAIPASSIGNED) {
        auto *e = (ip_event_ap_staipassigned_t *)data;
        ESP_LOGI(TAG, "phone got IP " IPSTR, IP2STR(&e->ip));
    }
}

static void wifi_start_ap() {
    esp_netif_t *ap = esp_netif_create_default_wifi_ap();
    // hand out ourselves as DNS server (see dns.cpp)
    esp_netif_dns_info_t dns = {};
    dns.ip.type = ESP_IPADDR_TYPE_V4;
    dns.ip.u_addr.ip4.addr = esp_ip4addr_aton("192.168.4.1");
    uint8_t offer_dns = 1;
    ESP_ERROR_CHECK(esp_netif_dhcps_stop(ap));
    ESP_ERROR_CHECK(esp_netif_set_dns_info(ap, ESP_NETIF_DNS_MAIN, &dns));
    ESP_ERROR_CHECK(esp_netif_dhcps_option(ap, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER, &offer_dns, sizeof offer_dns));
    ESP_ERROR_CHECK(esp_netif_dhcps_start(ap));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_ap_event, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_AP_STAIPASSIGNED, on_ap_event, nullptr));
    wifi_config_t cfg = {};
    strcpy((char *)cfg.ap.ssid, AP_SSID);
    strcpy((char *)cfg.ap.password, AP_PASSWORD);
    cfg.ap.ssid_len = strlen(AP_SSID);
    cfg.ap.channel = 6;
    cfg.ap.max_connection = 4;
    cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));  // STA interface is needed for scanning
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
    // 20 MHz channels: HT40 caused large transfers to stall on some phones
    ESP_ERROR_CHECK(esp_wifi_set_bandwidth(WIFI_IF_AP, WIFI_BW_HT20));
    ESP_LOGI(TAG, "WiFi '%s' (password '%s') -> http://192.168.4.1/", AP_SSID, AP_PASSWORD);
}

static EventGroupHandle_t sta_events;
static void on_sta_event(void *, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "WiFi disconnected, retrying");
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        auto *e = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "joined WiFi -> http://" IPSTR "/", IP2STR(&e->ip_info.ip));
        xEventGroupSetBits(sta_events, 1);
    }
}

// joins the configured network; false if none is configured or it did not work within 20 s
static bool wifi_start_sta() {
    std::string ssid, password;
    if (!wifi_creds_load(ssid, password)) return false;
    sta_events = xEventGroupCreate();
    esp_netif_t *sta = esp_netif_create_default_wifi_sta();
    esp_event_handler_instance_t h1, h2;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_sta_event, nullptr, &h1));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_sta_event, nullptr, &h2));
    wifi_config_t cfg = {};
    strncpy((char *)cfg.sta.ssid, ssid.c_str(), sizeof cfg.sta.ssid - 1);
    strncpy((char *)cfg.sta.password, password.c_str(), sizeof cfg.sta.password - 1);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &cfg));
    ESP_ERROR_CHECK(esp_wifi_start());
    if (xEventGroupWaitBits(sta_events, 1, pdFALSE, pdFALSE, pdMS_TO_TICKS(20000)) & 1) {
        ESP_ERROR_CHECK(mdns_init());
        mdns_hostname_set("nanovna");
        ESP_LOGI(TAG, "also reachable as http://nanovna.local/");
        return true;
    }
    ESP_LOGW(TAG, "could not join '%s', starting setup WiFi instead", ssid.c_str());
    esp_event_handler_instance_unregister(WIFI_EVENT, ESP_EVENT_ANY_ID, h1);
    esp_event_handler_instance_unregister(IP_EVENT, IP_EVENT_STA_GOT_IP, h2);
    esp_wifi_stop();
    esp_netif_destroy_default_wifi(sta);
    return false;
}

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

    // hold D0 (BOOT) while powering up / resetting to forget the stored WiFi
    gpio_set_direction(GPIO_NUM_0, GPIO_MODE_INPUT);
    gpio_set_pull_mode(GPIO_NUM_0, GPIO_PULLUP_ONLY);
    if (gpio_get_level(GPIO_NUM_0) == 0) {
        wifi_creds_clear();
        ESP_LOGI(TAG, "stored WiFi cleared");
    }

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    if (!wifi_start_sta()) {
        wifi_start_ap();
        dns_start();
        web_captive_portal = true;
    }
    vna_usb_init();
    web_start();
}
