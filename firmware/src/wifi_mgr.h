// WiFi manager: joins one of the stored networks, or opens the setup WiFi - SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <string>

#define AP_SSID "NanoVNA-Remote"
#define AP_PASSWORD "nanovna-remote"  // at least 8 characters; change it before using the device anywhere public

enum WifiState {
    WIFI_STARTING,    // booting, or searching for a known network
    WIFI_CONNECTING,  // trying a specific network
    WIFI_STA,         // joined a network
    WIFI_AP,          // setup WiFi is open
};

struct WifiStatus {
    WifiState state;
    std::string ssid;  // network joined / being tried (STA), or the setup WiFi's name (AP)
    std::string ip;
};

// force_ap: skip the stored networks and open the setup WiFi (D0 held at boot)
void wifi_mgr_start(bool force_ap);
WifiStatus wifi_mgr_status();
// Asynchronous requests; the result shows in wifi_mgr_status().
void wifi_mgr_connect(const std::string &ssid);  // a stored network; falls back to the setup WiFi if it does not work
void wifi_mgr_open_ap();                         // stays open until another network is chosen
