// SPDX-License-Identifier: GPL-3.0-or-later
#include "wifi_setup.h"

#include <algorithm>
#include <cstdio>
#include <set>

#include "esp_wifi.h"
#include "nvs.h"

static const char *NS = "wifinets";
static const char *OLD_NS = "wifi";  // single network of earlier firmware versions

static std::string get_str(nvs_handle_t h, const char *key) {
    char buf[65] = {};
    size_t n = sizeof buf;
    if (nvs_get_str(h, key, buf, &n) != ESP_OK) return "";
    return buf;
}

static void store(const std::vector<WifiNet> &nets) {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u8(h, "count", nets.size());
    for (size_t i = 0; i < nets.size(); i++) {
        char key[16];
        snprintf(key, sizeof key, "s%u", (unsigned)i);
        nvs_set_str(h, key, nets[i].ssid.c_str());
        snprintf(key, sizeof key, "p%u", (unsigned)i);
        nvs_set_str(h, key, nets[i].pass.c_str());
        snprintf(key, sizeof key, "e%u", (unsigned)i);
        nvs_set_u8(h, key, nets[i].enabled);
    }
    nvs_commit(h);
    nvs_close(h);
}

std::vector<WifiNet> wifi_nets_load() {
    std::vector<WifiNet> nets;
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) == ESP_OK) {
        uint8_t count = 0;
        nvs_get_u8(h, "count", &count);
        for (unsigned i = 0; i < count && i < WIFI_MAX_NETS; i++) {
            char key[16];
            WifiNet n;
            snprintf(key, sizeof key, "s%u", i);
            n.ssid = get_str(h, key);
            snprintf(key, sizeof key, "p%u", i);
            n.pass = get_str(h, key);
            snprintf(key, sizeof key, "e%u", i);
            uint8_t e = 1;
            nvs_get_u8(h, key, &e);
            n.enabled = e;
            if (!n.ssid.empty()) nets.push_back(n);
        }
        nvs_close(h);
        return nets;
    }
    // first start after an update: take over the one network of the old firmware
    if (nvs_open(OLD_NS, NVS_READWRITE, &h) == ESP_OK) {
        WifiNet n;
        n.ssid = get_str(h, "ssid");
        n.pass = get_str(h, "pass");
        nvs_erase_all(h);
        nvs_commit(h);
        nvs_close(h);
        if (!n.ssid.empty()) {
            nets.push_back(n);
            store(nets);
        }
    }
    return nets;
}

bool wifi_nets_add(const std::string &ssid, const std::string &pass) {
    auto nets = wifi_nets_load();
    auto it = std::find_if(nets.begin(), nets.end(), [&](const WifiNet &n) { return n.ssid == ssid; });
    if (it != nets.end()) {
        it->pass = pass;
        it->enabled = true;
    } else {
        if (nets.size() >= WIFI_MAX_NETS) return false;
        nets.push_back({ssid, pass, true});
    }
    store(nets);
    return true;
}

void wifi_nets_remove(size_t index) {
    auto nets = wifi_nets_load();
    if (index >= nets.size()) return;
    nets.erase(nets.begin() + index);
    store(nets);
}

void wifi_nets_set_enabled(size_t index, bool enabled) {
    auto nets = wifi_nets_load();
    if (index >= nets.size()) return;
    nets[index].enabled = enabled;
    store(nets);
}

std::string wifi_last_get() {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return "";
    std::string s = get_str(h, "last");
    nvs_close(h);
    return s;
}

void wifi_last_set(const std::string &ssid) {
    if (wifi_last_get() == ssid) return;  // spare the flash
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, "last", ssid.c_str());
    nvs_commit(h);
    nvs_close(h);
}

bool ui_flipped_get() {
    nvs_handle_t h;
    uint8_t v = 1;  // the picture the right way up for the button labels, until the user turns it
    if (nvs_open("ui", NVS_READONLY, &h) == ESP_OK) {
        nvs_get_u8(h, "flipped", &v);
        nvs_close(h);
    }
    return v;
}

void ui_flipped_set(bool flipped) {
    nvs_handle_t h;
    if (nvs_open("ui", NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u8(h, "flipped", flipped);
    nvs_commit(h);
    nvs_close(h);
}

std::vector<WifiScanResult> wifi_scan() {
    std::vector<WifiScanResult> out;
    if (esp_wifi_scan_start(nullptr, true) != ESP_OK) return out;
    uint16_t n = 0;
    esp_wifi_scan_get_ap_num(&n);
    if (n > 30) n = 30;
    std::vector<wifi_ap_record_t> aps(n);
    esp_wifi_scan_get_ap_records(&n, aps.data());
    std::sort(aps.begin(), aps.begin() + n, [](const wifi_ap_record_t &a, const wifi_ap_record_t &b) { return a.rssi > b.rssi; });
    std::set<std::string> seen;
    for (uint16_t i = 0; i < n; i++) {
        std::string name((const char *)aps[i].ssid);
        if (name.empty() || !seen.insert(name).second) continue;
        out.push_back({name, aps[i].rssi, aps[i].authmode != WIFI_AUTH_OPEN});
    }
    return out;
}
