// SPDX-License-Identifier: GPL-3.0-or-later
#include "dns.h"

#include <cstdint>
#include <cstring>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"

static const char *TAG = "dns";
static const uint8_t AP_IP[4] = {192, 168, 4, 1};

static void dns_task(void *) {
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(53);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (sock < 0 || bind(sock, (sockaddr *)&addr, sizeof addr) < 0) {
        ESP_LOGE(TAG, "cannot bind UDP port 53");
        vTaskDelete(nullptr);
    }
    uint8_t buf[512];
    while (true) {
        sockaddr_in from;
        socklen_t from_len = sizeof from;
        int n = recvfrom(sock, buf, sizeof buf - 16, 0, (sockaddr *)&from, &from_len);
        if (n < 12 || (buf[2] & 0x80)) continue;  // too short, or a response

        // skip the question name to find the type
        int p = 12;
        while (p < n && buf[p]) p += buf[p] + 1;
        p += 1 + 4;  // terminating 0, type, class
        if (p > n) continue;
        {
            char name[64] = {};
            for (int q = 12, o = 0; q < n && buf[q] && o < 60; q += buf[q] + 1) {
                for (int k = 1; k <= buf[q] && o < 60; k++) name[o++] = buf[q + k];
                name[o++] = '.';
            }
            ESP_LOGI(TAG, "query %s", name);
        }
        bool is_a = buf[p - 4] == 0 && buf[p - 3] == 1;

        buf[2] = 0x81;  // response, recursion desired
        buf[3] = 0x80;  // recursion available
        buf[6] = 0;
        buf[7] = is_a ? 1 : 0;  // answers
        buf[8] = buf[9] = buf[10] = buf[11] = 0;
        int len = p;
        if (is_a) {
            static const uint8_t answer_head[] = {0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4};
            memcpy(buf + len, answer_head, sizeof answer_head);
            len += sizeof answer_head;
            memcpy(buf + len, AP_IP, 4);
            len += 4;
        }
        sendto(sock, buf, len, 0, (sockaddr *)&from, from_len);
    }
}

// DIAGNOSTIC: logs connection attempts to the HTTPS port (nothing is served there)
static void https_probe_task(void *) {
    int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(443);
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (sock < 0 || bind(sock, (sockaddr *)&addr, sizeof addr) < 0 || listen(sock, 2) < 0) vTaskDelete(nullptr);
    while (true) {
        int c = accept(sock, nullptr, nullptr);
        if (c >= 0) {
            ESP_LOGI(TAG, "HTTPS connection attempt on port 443");
            close(c);
        }
    }
}

void dns_start() {
    xTaskCreate(https_probe_task, "https_probe", 3072, nullptr, 3, nullptr); xTaskCreate(dns_task, "dns", 4096, nullptr, 3, nullptr); }
