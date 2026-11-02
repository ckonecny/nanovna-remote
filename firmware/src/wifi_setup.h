// WiFi networks stored in flash, edited through the setup page (/wifi) - Copyright (C) 2026 Andreas Karpf, SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <string>
#include <vector>

#define WIFI_MAX_NETS 8

struct WifiNet {
    std::string ssid;
    std::string pass;
    bool enabled = true;
};

struct WifiScanResult {
    std::string ssid;
    int rssi;
    bool secure;
};

std::vector<WifiNet> wifi_nets_load();
// adds a network, or updates the password of an existing one with the same name; false if the list is full
bool wifi_nets_add(const std::string &ssid, const std::string &pass);
void wifi_nets_remove(size_t index);
void wifi_nets_set_enabled(size_t index, bool enabled);

// the network joined last, tried first at boot ("" if none)
std::string wifi_last_get();
void wifi_last_set(const std::string &ssid);

bool ui_flipped_get();
void ui_flipped_set(bool flipped);

// networks in range, strongest first, without duplicates (blocking scan, needs the station interface up)
std::vector<WifiScanResult> wifi_scan();
