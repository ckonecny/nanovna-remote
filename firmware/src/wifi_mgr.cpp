// SPDX-License-Identifier: GPL-3.0-or-later
#include "wifi_mgr.h"

#include <algorithm>
#include <cstring>

#include "dns.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "mdns.h"
#include "wifi_setup.h"

extern bool web_captive_portal;

static const char *TAG = "wifi";
static const int JOIN_TIMEOUT_MS = 10000;
static const int AP_RETRY_MS = 60000;  // the setup WiFi looks for the stored networks again this often while nobody is using it

enum { GOT_IP = 1, FAILED = 2 };
enum CmdType { CMD_START, CMD_CONNECT, CMD_AP };
struct Cmd {
    CmdType type;
    bool force_ap;
    char ssid[33];
};

static QueueHandle_t cmds;
static EventGroupHandle_t events;
static SemaphoreHandle_t status_lock;
static WifiStatus status = {WIFI_STARTING, "", ""};
static esp_netif_t *sta_netif, *ap_netif;
static volatile bool joining;  // a connection attempt is waiting for its result
static bool mdns_started;
static bool ap_user_requested;  // setup WiFi opened on purpose: do not leave it by itself

static void set_status(WifiState s, const std::string &ssid, const std::string &ip = "") {
    xSemaphoreTake(status_lock, portMAX_DELAY);
    status = {s, ssid, ip};
    xSemaphoreGive(status_lock);
}

WifiStatus wifi_mgr_status() {
    xSemaphoreTake(status_lock, portMAX_DELAY);
    WifiStatus copy = status;
    xSemaphoreGive(status_lock);
    return copy;
}

static void on_event(void *, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (joining) {
            xEventGroupSetBits(events, FAILED);
        } else if (wifi_mgr_status().state == WIFI_STA) {
            ESP_LOGW(TAG, "connection lost, retrying");
            esp_wifi_connect();
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(events, GOT_IP);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) {
        ESP_LOGI(TAG, "phone joined the setup WiFi");
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED) {
        ESP_LOGI(TAG, "phone left the setup WiFi");
    }
}

static bool join(const WifiNet &net) {
    ESP_LOGI(TAG, "joining '%s'", net.ssid.c_str());
    set_status(WIFI_CONNECTING, net.ssid);
    joining = false;
    esp_wifi_disconnect();
    vTaskDelay(pdMS_TO_TICKS(200));
    esp_wifi_set_mode(WIFI_MODE_STA);
    wifi_config_t cfg = {};
    strncpy((char *)cfg.sta.ssid, net.ssid.c_str(), sizeof cfg.sta.ssid - 1);
    strncpy((char *)cfg.sta.password, net.pass.c_str(), sizeof cfg.sta.password - 1);
    esp_wifi_set_config(WIFI_IF_STA, &cfg);
    xEventGroupClearBits(events, GOT_IP | FAILED);
    joining = true;
    esp_wifi_connect();
    EventBits_t bits = xEventGroupWaitBits(events, GOT_IP | FAILED, pdTRUE, pdFALSE, pdMS_TO_TICKS(JOIN_TIMEOUT_MS));
    joining = false;
    if (!(bits & GOT_IP)) {
        ESP_LOGW(TAG, "could not join '%s'", net.ssid.c_str());
        esp_wifi_disconnect();
        return false;
    }
    esp_netif_ip_info_t ip;
    esp_netif_get_ip_info(sta_netif, &ip);
    char text[16];
    snprintf(text, sizeof text, IPSTR, IP2STR(&ip.ip));
    ESP_LOGI(TAG, "joined '%s' -> http://%s/", net.ssid.c_str(), text);
    dns_stop();
    web_captive_portal = false;
    set_status(WIFI_STA, net.ssid, text);
    wifi_last_set(net.ssid);
    if (!mdns_started) {
        mdns_started = mdns_init() == ESP_OK;
        if (mdns_started) mdns_hostname_set("nanovna");
    }
    return true;
}

static void open_ap() {
    wifi_config_t cfg = {};
    strcpy((char *)cfg.ap.ssid, AP_SSID);
    strcpy((char *)cfg.ap.password, AP_PASSWORD);
    cfg.ap.ssid_len = strlen(AP_SSID);
    cfg.ap.channel = 6;
    cfg.ap.max_connection = 4;
    cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
    esp_wifi_disconnect();
    esp_wifi_set_mode(WIFI_MODE_APSTA);  // the station side stays for scanning
    esp_wifi_set_config(WIFI_IF_AP, &cfg);
    esp_wifi_set_bandwidth(WIFI_IF_AP, WIFI_BW_HT20);  // 40 MHz channels made large transfers stall on some phones
    dns_start();
    web_captive_portal = true;
    set_status(WIFI_AP, AP_SSID, "192.168.4.1");
    ESP_LOGI(TAG, "setup WiFi '%s' -> http://192.168.4.1/", AP_SSID);
}

// tries the enabled networks that are in range, the one used last first
static bool join_any() {
    auto nets = wifi_nets_load();
    nets.erase(std::remove_if(nets.begin(), nets.end(), [](const WifiNet &n) { return !n.enabled; }), nets.end());
    if (nets.empty()) return false;
    set_status(WIFI_STARTING, "");
    esp_wifi_set_mode(WIFI_MODE_STA);
    auto seen = wifi_scan();
    if (!seen.empty()) {  // an empty scan is more likely a failed scan than an empty sky: then try everything
        nets.erase(std::remove_if(nets.begin(), nets.end(), [&](const WifiNet &n) {
                       return std::none_of(seen.begin(), seen.end(), [&](const WifiScanResult &r) { return r.ssid == n.ssid; });
                   }), nets.end());
    }
    std::string last = wifi_last_get();
    std::stable_partition(nets.begin(), nets.end(), [&](const WifiNet &n) { return n.ssid == last; });
    for (const WifiNet &n : nets)
        if (join(n)) return true;
    return false;
}

static void mgr_task(void *) {
    TickType_t next_retry = 0;
    while (true) {
        Cmd c;
        if (xQueueReceive(cmds, &c, pdMS_TO_TICKS(2000)) == pdTRUE) {
            switch (c.type) {
                case CMD_START:
                    ap_user_requested = c.force_ap;
                    if (c.force_ap || !join_any()) open_ap();
                    break;
                case CMD_AP:
                    ap_user_requested = true;
                    open_ap();
                    break;
                case CMD_CONNECT: {
                    ap_user_requested = false;
                    auto nets = wifi_nets_load();
                    auto it = std::find_if(nets.begin(), nets.end(), [&](const WifiNet &n) { return n.ssid == c.ssid; });
                    if (it == nets.end() || !join(*it)) open_ap();
                    break;
                }
            }
            next_retry = xTaskGetTickCount() + pdMS_TO_TICKS(AP_RETRY_MS);
        } else if (wifi_mgr_status().state == WIFI_AP && !ap_user_requested && xTaskGetTickCount() >= next_retry) {
            next_retry = xTaskGetTickCount() + pdMS_TO_TICKS(AP_RETRY_MS);
            wifi_sta_list_t stations;
            if (esp_wifi_ap_get_sta_list(&stations) == ESP_OK && stations.num == 0 && join_any() == false) open_ap();
        }
    }
}

static void post(const Cmd &c) { xQueueSend(cmds, &c, 0); }

void wifi_mgr_start(bool force_ap) {
    status_lock = xSemaphoreCreateMutex();
    events = xEventGroupCreate();
    cmds = xQueueCreate(4, sizeof(Cmd));

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    sta_netif = esp_netif_create_default_wifi_sta();
    ap_netif = esp_netif_create_default_wifi_ap();
    // hand out ourselves as DNS server in the setup WiFi (see dns.cpp)
    esp_netif_dns_info_t dns = {};
    dns.ip.type = ESP_IPADDR_TYPE_V4;
    dns.ip.u_addr.ip4.addr = esp_ip4addr_aton("192.168.4.1");
    uint8_t offer_dns = 1;
    ESP_ERROR_CHECK(esp_netif_dhcps_stop(ap_netif));
    ESP_ERROR_CHECK(esp_netif_set_dns_info(ap_netif, ESP_NETIF_DNS_MAIN, &dns));
    ESP_ERROR_CHECK(esp_netif_dhcps_option(ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER, &offer_dns, sizeof offer_dns));
    // RFC 8910 captive portal URI: phones that look for it open the setup page right after joining
    static const char portal_uri[] = "http://192.168.4.1/wifi";
    ESP_ERROR_CHECK(esp_netif_dhcps_option(ap_netif, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI, (void *)portal_uri, sizeof portal_uri - 1));
    ESP_ERROR_CHECK(esp_netif_dhcps_start(ap_netif));

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, nullptr));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_start());

    xTaskCreate(mgr_task, "wifi_mgr", 6144, nullptr, 5, nullptr);
    Cmd c = {CMD_START, force_ap, ""};
    post(c);
}

void wifi_mgr_connect(const std::string &ssid) {
    Cmd c = {CMD_CONNECT, false, ""};
    strncpy(c.ssid, ssid.c_str(), sizeof c.ssid - 1);
    post(c);
}

void wifi_mgr_open_ap() {
    Cmd c = {CMD_AP, false, ""};
    post(c);
}
