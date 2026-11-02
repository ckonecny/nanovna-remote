// Tiny DNS server: answers every A query with the device's own address, so phones treat the WiFi as usable
// (Android checks connectivity through DNS + an HTTP 204 request) and http://nanovna.local-style names resolve.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
void dns_start();
void dns_stop();
