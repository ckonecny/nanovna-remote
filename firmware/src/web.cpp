// NanoVNA Remote web server: serves the browser client, bridges its WebSocket to the NanoVNA, WiFi setup, OTA
// Copyright (C) 2026 Andreas Karpf, SPDX-License-Identifier: GPL-3.0-or-later
#include "web.h"

#include <cstdio>
#include <cstdlib>
#include <cstdarg>
#include <cstring>
#include <mutex>
#include <vector>

#include <sys/socket.h>
#include <unistd.h>

#include "esp_http_server.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "vna.h"
#include "client_assets.h"
#include "wifi_setup.h"

static const char *TAG = "web";

bool web_captive_portal = false;

// ring buffer of recent log lines, served at /log (the USB port is busy as host, so there is no serial console)
static char log_ring[16384];
static size_t log_pos = 0;
static bool log_wrapped = false;
static portMUX_TYPE log_lock = portMUX_INITIALIZER_UNLOCKED;
static vprintf_like_t log_previous;
static int log_hook(const char *fmt, va_list args) {
    char line[200];
    va_list copy;
    va_copy(copy, args);
    int n = vsnprintf(line, sizeof line, fmt, copy);
    va_end(copy);
    if (n > (int)sizeof line - 1) n = sizeof line - 1;
    portENTER_CRITICAL(&log_lock);
    for (int i = 0; i < n; i++) {
        log_ring[log_pos] = line[i];
        if (++log_pos == sizeof log_ring) { log_pos = 0; log_wrapped = true; }
    }
    portEXIT_CRITICAL(&log_lock);
    return log_previous ? log_previous(fmt, args) : n;
}  // set when running as own access point


namespace {

httpd_handle_t server;

esp_err_t send_json(httpd_req_t *req, const char *status, const std::string &body) {
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, body.data(), body.size());
}

// reads the (small) request body into buf, null-terminated
bool read_body(httpd_req_t *req, char *buf, size_t size) {
    if (req->content_len == 0 || req->content_len >= size) return false;
    size_t got = 0;
    while (got < req->content_len) {
        int n = httpd_req_recv(req, buf + got, req->content_len - got);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0) return false;
        got += n;
    }
    buf[got] = 0;
    return true;
}

esp_err_t info_handler(httpd_req_t *req) { return send_json(req, "200 OK", "{\"name\":\"NanoVNA Remote\"}"); }

esp_err_t send_detail(httpd_req_t *req, const char *status, const std::string &detail) {
    return send_json(req, status, "{\"detail\":\"" + detail + "\"}");
}

// Serves the embedded web client (gzip). Unknown paths fall through to the 404 handler.
esp_err_t asset_handler(httpd_req_t *req) {
    const char *q = strchr(req->uri, '?');
    std::string path(req->uri, q ? (size_t)(q - req->uri) : strlen(req->uri));
    if (path == "/") path = "/index.html";
    for (unsigned i = 0; i < CLIENT_ASSET_COUNT; i++) {
        const ClientAsset &a = CLIENT_ASSETS[i];
        if (path != a.path) continue;
        httpd_resp_set_type(req, a.type);
        httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
        httpd_resp_set_hdr(req, "Cache-Control", path.rfind("/assets/", 0) == 0 ? "max-age=31536000, immutable" : "no-cache");
        return httpd_resp_send(req, (const char *)a.data, a.size);
    }
    return httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, nullptr);
}

std::string url_decode(const std::string &in) {
    std::string out;
    for (size_t i = 0; i < in.size(); i++) {
        if (in[i] == '+') out += ' ';
        else if (in[i] == '%' && i + 2 < in.size() + 0 && isxdigit((unsigned char)in[i + 1]) && isxdigit((unsigned char)in[i + 2])) {
            out += (char)strtol(in.substr(i + 1, 2).c_str(), nullptr, 16);
            i += 2;
        } else out += in[i];
    }
    return out;
}

std::string form_field(const std::string &body, const char *key) {
    std::string k = std::string(key) + "=";
    size_t p = body.find(k);
    if (p != 0 && (p == std::string::npos || body[p - 1] != '&')) return "";
    size_t e = body.find('&', p);
    return url_decode(body.substr(p + k.size(), e == std::string::npos ? e : e - p - k.size()));
}

esp_err_t wifi_page_handler(httpd_req_t *req) {
    std::string html =
        "<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>NanoVNA Tuner WiFi</title><style>body{font-family:sans-serif;max-width:26em;margin:1em auto;padding:0 1em}"
        "input,button{font-size:1.1em;width:100%;box-sizing:border-box;margin:.4em 0;padding:.5em}</style></head><body>"
        "<h2>Connect to your WiFi</h2><p>Choose the network the tuner should join. Afterwards it restarts and is reachable at "
        "<b>http://nanovna.local/</b> (or the IP shown on the log). Hold D0 while resetting to forget the network.</p>"
        "<form method=post action=/api/wifi><input name=ssid list=nets placeholder='Network name' required>"
        "<datalist id=nets>" + wifi_scan_options() + "</datalist>"
        "<input name=pass type=password placeholder='Password' maxlength=64><button>Save and restart</button></form>"
        "<p><a href=/>Skip, use the tuner on this WiFi</a></p></body></html>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, html.data(), html.size());
}

esp_err_t wifi_save_handler(httpd_req_t *req) {
    char buf[256];
    if (!read_body(req, buf, sizeof buf)) return send_detail(req, "422 Unprocessable Entity", "Invalid form");
    std::string ssid = form_field(buf, "ssid"), pass = form_field(buf, "pass");
    if (ssid.empty() || ssid.size() > 32 || pass.size() > 64) return send_detail(req, "422 Unprocessable Entity", "Invalid network");
    wifi_creds_save(ssid, pass);
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><body style='font-family:sans-serif;padding:1em'>"
                         "<h2>Saved</h2><p>Restarting. Join your normal WiFi again and open <b>http://nanovna.local/</b>. "
                         "If this WiFi appears again, the password was wrong - connect and retry.</p>", HTTPD_RESP_USE_STRLEN);
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
    return ESP_OK;
}

esp_err_t log_handler(httpd_req_t *req) {
    static char snapshot[sizeof log_ring + 1];
    size_t n;
    portENTER_CRITICAL(&log_lock);
    if (log_wrapped) {
        memcpy(snapshot, log_ring + log_pos, sizeof log_ring - log_pos);
        memcpy(snapshot + sizeof log_ring - log_pos, log_ring, log_pos);
        n = sizeof log_ring;
    } else {
        memcpy(snapshot, log_ring, log_pos);
        n = log_pos;
    }
    portEXIT_CRITICAL(&log_lock);
    httpd_resp_set_type(req, "text/plain");
    return httpd_resp_send(req, snapshot, n);
}

// ---- WebSocket bridge: /ws passes bytes unchanged between the browser and the NanoVNA's USB serial port ----
std::mutex bridge_mutex;
int bridge_fd = -1;       // socket of the active session, -1 if none
uint32_t bridge_gen = 0;  // identifies the session the pump task belongs to
size_t bridge_up = 0, bridge_down = 0;

volatile bool bridge_pump_active = false;  // the pump task is the only reader of the NanoVNA's receive buffer

void bridge_end(int fd) {
    {
        std::lock_guard<std::mutex> lock(bridge_mutex);
        if (fd != bridge_fd) return;
        bridge_fd = -1;
    }
    for (int i = 0; i < 100 && bridge_pump_active; i++) vTaskDelay(pdMS_TO_TICKS(10));  // pump notices bridge_fd < 0
    vna_bridge_close();
    ESP_LOGI(TAG, "bridge closed (%u bytes to NanoVNA, %u bytes to browser)", (unsigned)bridge_up, (unsigned)bridge_down);
}

void bridge_pump_task(void *arg) {
    uint32_t gen = (uint32_t)(uintptr_t)arg;
    static uint8_t buf[1024];
    while (true) {
        int fd;
        {
            std::lock_guard<std::mutex> lock(bridge_mutex);
            if (bridge_fd < 0 || gen != bridge_gen) break;
            fd = bridge_fd;
        }
        if (!vna_bridge_alive()) {
            ESP_LOGW(TAG, "bridge: NanoVNA gone");
            httpd_sess_trigger_close(server, fd);
            break;
        }
        size_t n = vna_bridge_read(buf, sizeof buf, 100);
        if (!n) continue;
        httpd_ws_frame_t frame = {};
        frame.type = HTTPD_WS_TYPE_BINARY;
        frame.final = true;
        frame.payload = buf;
        frame.len = n;
        if (httpd_ws_send_frame_async(server, fd, &frame) != ESP_OK) {
            httpd_sess_trigger_close(server, fd);
            break;
        }
        bridge_down += n;
    }
    bridge_pump_active = false;
    vTaskDelete(nullptr);
}

esp_err_t ws_handler(httpd_req_t *req) {
    int fd = httpd_req_to_sockfd(req);
    if (req->method == HTTP_GET) {  // handshake: a new session starts
        int previous;
        {
            std::lock_guard<std::mutex> lock(bridge_mutex);
            previous = bridge_fd;
        }
        if (previous >= 0) {  // a newer browser tab takes over
            httpd_sess_trigger_close(server, previous);
            bridge_end(previous);
        }
        std::lock_guard<std::mutex> lock(bridge_mutex);
        std::string err;
        if (!vna_bridge_open(err)) {
            ESP_LOGW(TAG, "bridge open failed: %s", err.c_str());
            return ESP_FAIL;
        }
        bridge_fd = fd;
        bridge_gen++;
        bridge_up = bridge_down = 0;
        bridge_pump_active = true;
        xTaskCreate(bridge_pump_task, "bridge_pump", 4096, (void *)(uintptr_t)bridge_gen, 5, nullptr);
        ESP_LOGI(TAG, "bridge opened on socket %d", fd);
        return ESP_OK;
    }
    httpd_ws_frame_t frame = {};
    esp_err_t err = httpd_ws_recv_frame(req, &frame, 0);
    if (err != ESP_OK) return err;
    if (frame.len == 0 || frame.type == HTTPD_WS_TYPE_CLOSE) return ESP_OK;
    if (frame.type != HTTPD_WS_TYPE_TEXT && frame.type != HTTPD_WS_TYPE_BINARY) return ESP_OK;
    std::vector<uint8_t> payload(frame.len);
    frame.payload = payload.data();
    err = httpd_ws_recv_frame(req, &frame, frame.len);
    if (err != ESP_OK) return err;
    if (fd != bridge_fd || !vna_bridge_write(payload.data(), payload.size())) return ESP_FAIL;
    bridge_up += payload.size();
    return ESP_OK;
}

// the browser-side (app) calibration of the NanoVNA, kept as opaque JSON so that every browser sees the same one
constexpr const char *APPCAL_PATH = "/spiffs/appcal.json";
constexpr size_t APPCAL_MAX = 400 * 1024;

esp_err_t appcal_get_handler(httpd_req_t *req) {
    FILE *f = fopen(APPCAL_PATH, "rb");
    if (!f) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_send(req, "", 0);
    }
    httpd_resp_set_type(req, "application/json");
    static char chunk[1024];
    size_t n;
    while ((n = fread(chunk, 1, sizeof chunk, f)) > 0) {
        if (httpd_resp_send_chunk(req, chunk, n) != ESP_OK) break;
    }
    fclose(f);
    return httpd_resp_send_chunk(req, nullptr, 0);
}

esp_err_t appcal_put_handler(httpd_req_t *req) {
    if (req->content_len > APPCAL_MAX) return httpd_resp_send_err(req, HTTPD_413_CONTENT_TOO_LARGE, "calibration too large");
    FILE *f = fopen(APPCAL_PATH, "wb");
    if (!f) return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "cannot write");
    static char chunk[1024];
    size_t left = req->content_len;
    bool ok = true;
    while (left > 0) {
        int n = httpd_req_recv(req, chunk, left < sizeof chunk ? left : sizeof chunk);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0 || fwrite(chunk, 1, n, f) != (size_t)n) { ok = false; break; }
        left -= n;
    }
    fclose(f);
    if (!ok) {
        remove(APPCAL_PATH);
        return httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "write failed");
    }
    return httpd_resp_sendstr(req, "{\"ok\":true}");
}

// Firmware update over WiFi: POST the raw .bin to /api/ota (see tools/ota.sh)
esp_err_t ota_handler(httpd_req_t *req) {
    const esp_partition_t *target = esp_ota_get_next_update_partition(nullptr);
    esp_ota_handle_t ota;
    // no USB traffic while flash is being written (interrupts during cache-off crash the chip); the device restarts afterwards
    int bridge_socket = bridge_fd;
    if (bridge_socket >= 0) {  // end an open bridge session properly (its pump task is still reading the port)
        httpd_sess_trigger_close(server, bridge_socket);
        bridge_end(bridge_socket);
    }
    vna_usb_release();
    if (!target || esp_ota_begin(target, OTA_WITH_SEQUENTIAL_WRITES, &ota) != ESP_OK)
        return send_detail(req, "500 Internal Server Error", "OTA begin failed");
    static uint8_t buf[2048];
    size_t left = req->content_len;
    ESP_LOGI(TAG, "OTA: receiving %u bytes", (unsigned)left);
    while (left > 0) {
        int n = httpd_req_recv(req, (char *)buf, left < sizeof buf ? left : sizeof buf);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0 || esp_ota_write(ota, buf, n) != ESP_OK) {
            esp_ota_abort(ota);
            ESP_LOGW(TAG, "OTA: transfer failed");
            return send_detail(req, "500 Internal Server Error", "OTA write failed");
        }
        left -= n;
    }
    if (esp_ota_end(ota) != ESP_OK || esp_ota_set_boot_partition(target) != ESP_OK)
        return send_detail(req, "500 Internal Server Error", "Image rejected");
    send_json(req, "200 OK", "{\"ok\":true}");
    ESP_LOGI(TAG, "OTA done, restarting");
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_restart();
    return ESP_OK;
}

// Captive portal: connectivity checks of Android / iOS / Windows ask for URLs on random hosts (our DNS points them all
// here). Redirecting them to our page makes the phone offer "sign in to network" and open the client.
esp_err_t redirect_handler(httpd_req_t *req, httpd_err_code_t) {
    if (!web_captive_portal) return httpd_resp_send_404(req);
    ESP_LOGI(TAG, "redirect %s", req->uri);
    httpd_resp_set_status(req, "302 Found");
    std::string ssid, pass;
    httpd_resp_set_hdr(req, "Location", wifi_creds_load(ssid, pass) ? "http://192.168.4.1/" : "http://192.168.4.1/wifi");
    return httpd_resp_send(req, "Redirecting", HTTPD_RESP_USE_STRLEN);
}

}  // namespace

void web_log_capture() { log_previous = esp_log_set_vprintf(log_hook); }

void web_start() {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 8192;
    config.max_uri_handlers = 24;
    config.max_open_sockets = 7;
    config.lru_purge_enable = true;
    config.send_wait_timeout = 5;
    config.recv_wait_timeout = 10;
    config.uri_match_fn = httpd_uri_match_wildcard;
    config.open_fn = [](httpd_handle_t, int fd) {
        ESP_LOGI(TAG, "socket %d opened", fd);
        return ESP_OK;
    };
    config.close_fn = [](httpd_handle_t h, int fd) {
        ESP_LOGI(TAG, "socket %d closed", fd);
        bridge_end(fd);
        close(fd);
    };
    ESP_ERROR_CHECK(httpd_start(&server, &config));

    const httpd_uri_t routes[] = {
        {.uri = "/api/appcal", .method = HTTP_GET, .handler = appcal_get_handler, .user_ctx = nullptr},
        {.uri = "/api/appcal", .method = HTTP_PUT, .handler = appcal_put_handler, .user_ctx = nullptr},
        {.uri = "/api/ota", .method = HTTP_POST, .handler = ota_handler, .user_ctx = nullptr},
        {.uri = "/ws", .method = HTTP_GET, .handler = ws_handler, .user_ctx = nullptr, .is_websocket = true},
        {.uri = "/log", .method = HTTP_GET, .handler = log_handler, .user_ctx = nullptr},
        {.uri = "/wifi", .method = HTTP_GET, .handler = wifi_page_handler, .user_ctx = nullptr},
        {.uri = "/api/wifi", .method = HTTP_POST, .handler = wifi_save_handler, .user_ctx = nullptr},
        {.uri = "/api/info", .method = HTTP_GET, .handler = info_handler, .user_ctx = nullptr},
        {.uri = "/*", .method = HTTP_GET, .handler = asset_handler, .user_ctx = nullptr},
    };
    for (const auto &route : routes) ESP_ERROR_CHECK(httpd_register_uri_handler(server, &route));
    ESP_ERROR_CHECK(httpd_register_err_handler(server, HTTPD_404_NOT_FOUND, redirect_handler));
    ESP_LOGI(TAG, "Web server on port %d", config.server_port);
}
