// USB host side of the NanoVNA bridge: keeps the NanoVNA's CDC-ACM port open and passes bytes through
// Copyright (C) 2026 Andreas Karpf, SPDX-License-Identifier: GPL-3.0-or-later
#include <memory>
#include <mutex>
#include "vna.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/stream_buffer.h"
#include "freertos/task.h"

#include "usb/cdc_acm_host.h"
#include "usb/usb_host.h"

static const char *TAG = "vna";


// ---------------------------------------------------------------------------------------------------------------------
// USB CDC-ACM serial link (replaces pyserial)
// ---------------------------------------------------------------------------------------------------------------------
namespace {

constexpr uint16_t NANOVNA_VID = 0x0483, NANOVNA_PID = 0x5740;  // STM32 virtual COM port: NanoVNA / -H / -H4
constexpr uint16_t V2_VID = 0x04B4, V2_PID = 0x0008;            // NanoVNA V2 / V2 Plus4 / LiteVNA

class Port {
public:
    ~Port() {
        if (hdl_) cdc_acm_host_close(hdl_);
        if (rx_) vStreamBufferDelete(rx_);
    }

    bool open(uint16_t vid, uint16_t pid, size_t rx_size = 32 * 1024) {
        rx_ = xStreamBufferCreate(rx_size, 1);
        cdc_acm_host_device_config_t cfg = {};
        cfg.connection_timeout_ms = 300;
        cfg.out_buffer_size = 512;
        cfg.event_cb = on_event;
        cfg.data_cb = on_data;
        cfg.user_arg = this;
        if (cdc_acm_host_open(vid, pid, 0, &cfg, &hdl_) != ESP_OK) {
            hdl_ = nullptr;
            return false;
        }
        cdc_acm_line_coding_t coding = {};
        coding.dwDTERate = 115200;
        coding.bDataBits = 8;
        cdc_acm_host_line_coding_set(hdl_, &coding);
        cdc_acm_host_set_control_line_state(hdl_, true, true);  // pyserial raises DTR/RTS on open as well
        return true;
    }

    bool alive() const { return !gone_; }

    // The NanoVNA-H can stop answering on its bulk endpoints (display and firmware keep running, the port just NAKs
    // forever), most likely after its data toggle fell out of step with ours. CLEAR_FEATURE(ENDPOINT_HALT) travels
    // over endpoint 0 and resets that state; the port is then reopened (fresh host pipes) on the next acquire().
    void recover() {
        if (gone_ || !hdl_) return;
        // escalate with every attempt until the NanoVNA answers again
        static unsigned round = 0;
        unsigned step = round++ % 3;
        ESP_LOGW(TAG, "NanoVNA not answering: recovery step %u", step);
        if (step >= 0) {
            for (uint8_t ep : {0x01, 0x81}) {
                esp_err_t err = cdc_acm_host_send_custom_request(hdl_, 0x02, 0x01, 0, ep, 0, nullptr);
                ESP_LOGW(TAG, "  CLEAR_FEATURE(HALT) endpoint 0x%02x -> %s", ep, esp_err_to_name(err));
            }
        }
        if (step >= 1) {
            esp_err_t err = cdc_acm_host_set_control_line_state(hdl_, false, false);
            vTaskDelay(pdMS_TO_TICKS(300));
            err = cdc_acm_host_set_control_line_state(hdl_, true, true);
            ESP_LOGW(TAG, "  DTR/RTS toggled -> %s", esp_err_to_name(err));
        }
        if (step >= 2) {
            esp_err_t err = cdc_acm_host_send_custom_request(hdl_, 0x00, 0x09, 1, 0, 0, nullptr);
            ESP_LOGW(TAG, "  SET_CONFIGURATION(1) -> %s", esp_err_to_name(err));
        }
        gone_ = true;
    }

    bool write(const void *data, size_t len) {
        if (gone_) return false;
        if (cdc_acm_host_data_tx_blocking(hdl_, (const uint8_t *)data, len, 1000) == ESP_OK) {
            tx_failures_ = 0;
            return true;
        }
        if (++tx_failures_ >= 3) recover();
        return false;
    }

    void flush() {
        uint8_t tmp[64];
        while (xStreamBufferReceive(rx_, tmp, sizeof tmp, 0) > 0) {
        }
    }

    // returns whatever is available (at least 1 byte) or 0 after timeout_ms
    size_t read_some(uint8_t *buf, size_t n, uint32_t timeout_ms) { return xStreamBufferReceive(rx_, buf, n, pdMS_TO_TICKS(timeout_ms)); }

    size_t dropped() const { return dropped_; }

    // Lets the device finish what it is sending: closing the port in the middle of a sweep or screenshot has left the
    // NanoVNA-H's USB stack unresponsive until it was restarted.
    void quiesce(uint32_t idle_ms, uint32_t max_ms) {
        uint8_t tmp[256];
        TickType_t end = xTaskGetTickCount() + pdMS_TO_TICKS(max_ms);
        while (!gone_ && xTaskGetTickCount() < end) {
            if (xStreamBufferReceive(rx_, tmp, sizeof tmp, pdMS_TO_TICKS(idle_ms)) == 0) return;
        }
    }

    // reads exactly n bytes or fails after timeout_ms without progress
    bool read_exact(uint8_t *buf, size_t n, uint32_t timeout_ms) {
        size_t got = 0;
        while (got < n) {
            size_t k = xStreamBufferReceive(rx_, buf + got, n - got, pdMS_TO_TICKS(timeout_ms));
            if (k == 0 || gone_) return false;
            got += k;
        }
        return true;
    }

    // appends to out until it ends with `suffix`; fails after timeout_ms without progress or at max_len
    bool read_until(std::string &out, const char *suffix, uint32_t timeout_ms, size_t max_len) {
        size_t sl = strlen(suffix);
        uint8_t buf[256];
        while (out.size() < max_len) {
            size_t k = xStreamBufferReceive(rx_, buf, sizeof buf, pdMS_TO_TICKS(timeout_ms));
            if (k == 0 || gone_) return false;
            out.append((const char *)buf, k);
            if (out.size() >= sl && out.compare(out.size() - sl, sl, suffix) == 0) return true;
        }
        return false;
    }

private:
    static bool on_data(const uint8_t *data, size_t len, void *arg) {
        auto *self = (Port *)arg;
        size_t sent = xStreamBufferSend(self->rx_, data, len, 0);
        self->dropped_ += len - sent;
        return true;  // data consumed
    }
    static void on_event(const cdc_acm_host_dev_event_data_t *event, void *arg) {
        if (event->type == CDC_ACM_HOST_DEVICE_DISCONNECTED || event->type == CDC_ACM_HOST_ERROR)
            ((Port *)arg)->gone_ = true;
    }

    cdc_acm_dev_hdl_t hdl_ = nullptr;
    StreamBufferHandle_t rx_ = nullptr;
    volatile bool gone_ = false;
    int tx_failures_ = 0;
    volatile size_t dropped_ = 0;
};


// The USB port stays open for as long as the device is attached and is shared by the sweep worker and the serial bridge.
// Closing and reopening it for every session (DTR toggling, endpoints torn down mid-transfer) left the NanoVNA-H's
// USB stack unresponsive after a few cycles.
class SerialLink {
public:
    bool open(uint16_t vid, uint16_t pid, size_t = 0) {
        port_ = acquire(vid, pid);
        return port_ != nullptr;
    }
    bool alive() const { return port_ && port_->alive(); }
    void recover() { if (port_) port_->recover(); }
    bool write(const void *data, size_t len) { return port_ && port_->write(data, len); }
    void flush() { if (port_) port_->flush(); }
    size_t read_some(uint8_t *buf, size_t n, uint32_t timeout_ms) { return port_ ? port_->read_some(buf, n, timeout_ms) : 0; }
    size_t dropped() const { return port_ ? port_->dropped() : 0; }
    void quiesce(uint32_t idle_ms, uint32_t max_ms) { if (port_) port_->quiesce(idle_ms, max_ms); }
    bool read_exact(uint8_t *buf, size_t n, uint32_t timeout_ms) { return port_ && port_->read_exact(buf, n, timeout_ms); }
    bool read_until(std::string &out, const char *suffix, uint32_t timeout_ms, size_t max_len) {
        return port_ && port_->read_until(out, suffix, timeout_ms, max_len);
    }

    // closes the pooled ports (as soon as their users let go of them)
    static void release_all() {
        std::lock_guard<std::mutex> lock(pool_mutex());
        for (auto &slot : pool()) slot.reset();
    }

private:
    static std::mutex &pool_mutex() {
        static std::mutex mutex;
        return mutex;
    }
    static std::shared_ptr<Port> (&pool())[2] {
        static std::shared_ptr<Port> slots[2];
        return slots;
    }
    static std::shared_ptr<Port> acquire(uint16_t vid, uint16_t pid) {
        std::lock_guard<std::mutex> lock(pool_mutex());
        auto &slot = pool()[vid == V2_VID ? 1 : 0];
        if (slot && !slot->alive()) slot.reset();
        if (!slot) {
            auto port = std::make_shared<Port>();
            if (!port->open(vid, pid, 64 * 1024)) return nullptr;
            slot = std::move(port);
        }
        slot->flush();
        return slot;
    }

    std::shared_ptr<Port> port_;
};

void usb_lib_task(void *) {
    while (true) {
        uint32_t flags;
        usb_host_lib_handle_events(portMAX_DELAY, &flags);
        if (flags & USB_HOST_LIB_EVENT_FLAGS_NO_CLIENTS) usb_host_device_free_all();
    }
}

}  // namespace

// logs every device that shows up on the bus (VID/PID, speed), so a missing NanoVNA can be told apart from a missing hub
static usb_host_client_handle_t diag_client;
static volatile int usb_devices;
bool vna_usb_attached() { return usb_devices > 0; }

static void diag_event(const usb_host_client_event_msg_t *msg, void *) {
    if (msg->event == USB_HOST_CLIENT_EVENT_NEW_DEV) {
        usb_devices = usb_devices + 1;
        usb_device_handle_t dev;
        if (usb_host_device_open(diag_client, msg->new_dev.address, &dev) == ESP_OK) {
            const usb_device_desc_t *desc;
            usb_device_info_t info;
            if (usb_host_get_device_descriptor(dev, &desc) == ESP_OK && usb_host_device_info(dev, &info) == ESP_OK)
                ESP_LOGI(TAG, "USB device addr %d: VID %04x PID %04x class %02x speed %s", msg->new_dev.address, desc->idVendor,
                         desc->idProduct, desc->bDeviceClass, info.speed == USB_SPEED_FULL ? "full" : info.speed == USB_SPEED_LOW ? "low" : "high");
            usb_host_device_close(diag_client, dev);
        }
    } else if (msg->event == USB_HOST_CLIENT_EVENT_DEV_GONE) {
        if (usb_devices > 0) usb_devices = usb_devices - 1;
        ESP_LOGI(TAG, "USB device removed");
    }
}
static void diag_task(void *) {
    while (true) usb_host_client_handle_events(diag_client, portMAX_DELAY);
}

void vna_usb_init() {
    usb_host_config_t host_cfg = {};
    host_cfg.skip_phy_setup = false;
    host_cfg.intr_flags = ESP_INTR_FLAG_LEVEL1;
    ESP_ERROR_CHECK(usb_host_install(&host_cfg));
    xTaskCreate(usb_lib_task, "usb_lib", 4096, nullptr, 10, nullptr);
    usb_host_client_config_t client_cfg = {};
    client_cfg.max_num_event_msg = 5;
    client_cfg.async.client_event_callback = diag_event;
    if (usb_host_client_register(&client_cfg, &diag_client) == ESP_OK) xTaskCreate(diag_task, "usb_diag", 4096, nullptr, 9, nullptr);
    ESP_ERROR_CHECK(cdc_acm_host_install(nullptr));
    ESP_LOGI(TAG, "USB host ready");
}

static std::unique_ptr<SerialLink> bridge_link;

bool vna_bridge_open(std::string &err) {
    vna_bridge_close();
    auto link = std::make_unique<SerialLink>();
    if (!link->open(NANOVNA_VID, NANOVNA_PID, 64 * 1024)) {
        link = std::make_unique<SerialLink>();
        if (!link->open(V2_VID, V2_PID, 64 * 1024)) {
            err = "NanoVNA not found - is it plugged in, switched on and powered over USB?";
            return false;
        }
    }
    bridge_link = std::move(link);
    return true;
}

bool vna_bridge_write(const uint8_t *data, size_t len) { return bridge_link && bridge_link->write(data, len); }

size_t vna_bridge_read(uint8_t *buf, size_t n, uint32_t timeout_ms) {
    return bridge_link ? bridge_link->read_some(buf, n, timeout_ms) : 0;
}

bool vna_bridge_alive() { return bridge_link && bridge_link->alive(); }

void vna_usb_release() { SerialLink::release_all(); }

void vna_bridge_close() {
    if (bridge_link && bridge_link->dropped()) ESP_LOGW(TAG, "bridge dropped %u bytes (receive buffer full)", (unsigned)bridge_link->dropped());
    if (bridge_link) bridge_link->quiesce(300, 3000);
    bridge_link.reset();
}

