// USB host side of the NanoVNA bridge - Copyright (C) 2026 Christian Konecny, SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>

void vna_usb_init();
// Is any USB device plugged into the Feather's USB-C port?
bool vna_usb_attached();

// Transparent serial bridge to a NanoVNA: bytes pass through unchanged. Only one session at a time.
bool vna_bridge_open(std::string &err);
bool vna_bridge_write(const uint8_t *data, size_t len);
size_t vna_bridge_read(uint8_t *buf, size_t n, uint32_t timeout_ms);  // 0 on timeout
bool vna_bridge_alive();
void vna_bridge_close();

// Closes the USB port. Used before flashing: with the cache off, a USB interrupt would crash the chip.
void vna_usb_release();
