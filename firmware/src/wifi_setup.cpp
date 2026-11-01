// Copyright (C) 2026 Andreas Karpf, SPDX-License-Identifier: GPL-3.0-or-later
#include "wifi_setup.h"

#include <set>
#include <vector>

#include "esp_wifi.h"
#include "nvs.h"

static const char *NS = "wifi";

bool wifi_creds_load(std::string &ssid, std::string &password) {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
    char s[33] = {}, p[65] = {};
    size_t sl = sizeof s, pl = sizeof p;
    bool ok = nvs_get_str(h, "ssid", s, &sl) == ESP_OK;
    nvs_get_str(h, "pass", p, &pl);
    nvs_close(h);
    ssid = s;
    password = p;
    return ok && !ssid.empty();
}

void wifi_creds_save(const std::string &ssid, const std::string &password) {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, "ssid", ssid.c_str());
    nvs_set_str(h, "pass", password.c_str());
    nvs_commit(h);
    nvs_close(h);
}

void wifi_creds_clear() {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_erase_all(h);
    nvs_commit(h);
    nvs_close(h);
}

std::string wifi_scan_options() {
    std::string out;
    if (esp_wifi_scan_start(nullptr, true) != ESP_OK) return out;
    uint16_t n = 0;
    esp_wifi_scan_get_ap_num(&n);
    if (n > 20) n = 20;
    std::vector<wifi_ap_record_t> aps(n);
    esp_wifi_scan_get_ap_records(&n, aps.data());
    std::set<std::string> seen;
    for (uint16_t i = 0; i < n; i++) {
        std::string name((const char *)aps[i].ssid);
        if (name.empty() || !seen.insert(name).second) continue;
        std::string esc;
        for (char c : name) {
            if (c == '<') esc += "&lt;";
            else if (c == '>') esc += "&gt;";
            else if (c == '&') esc += "&amp;";
            else if (c == '"') esc += "&quot;";
            else esc += c;
        }
        out += "<option value=\"" + esc + "\">";
    }
    return out;
}
