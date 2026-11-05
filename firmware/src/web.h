// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once

void web_start();
// true while a browser holds the WebSocket bridge to the NanoVNA (an open page that is not connected does not count)
bool web_browser_connected();
