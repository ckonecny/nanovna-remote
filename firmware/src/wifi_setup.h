// WiFi credentials stored in flash, entered through the setup page (/wifi) - Copyright (C) 2026 Andreas Karpf, SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <string>

bool wifi_creds_load(std::string &ssid, std::string &password);
void wifi_creds_save(const std::string &ssid, const std::string &password);
void wifi_creds_clear();
// <option> elements for the networks currently in range (blocking scan, needs the station interface up)
std::string wifi_scan_options();
