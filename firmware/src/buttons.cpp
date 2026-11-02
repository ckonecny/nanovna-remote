// SPDX-License-Identifier: GPL-3.0-or-later
#include "buttons.h"

#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static const int POLL_MS = 10;  // not below the tick (10 ms), or vTaskDelay returns at once and starves the idle task
static const int DEBOUNCE_MS = 30;
static const int LONG_MS = 600;
static const int DOUBLE_MS = 300;

// D0 is the BOOT button and switches to GND. D1 and D2 switch to 3.3 V and the board has no pull-downs for them.
struct Pin {
    gpio_num_t gpio;
    bool active_high;
};
static const Pin pins[BTN_COUNT] = {{GPIO_NUM_0, false}, {GPIO_NUM_1, true}, {GPIO_NUM_2, true}};

static QueueHandle_t events;
static volatile bool double_enabled[BTN_COUNT];

bool button_down(Button b) { return gpio_get_level(pins[b].gpio) == (pins[b].active_high ? 1 : 0); }

static void post(Button b, ButtonEvent e) {
    ButtonMessage m = {b, e};
    xQueueSend(events, &m, 0);
}

static void button_task(void *) {
    struct State {
        bool down = false;        // debounced
        bool raw = false;
        int raw_ms = 0;           // how long raw has differed from down
        int held_ms = 0;
        bool long_sent = false;
        int pending_ms = -1;      // >= 0: a short press is waiting to see whether a second one follows
    } st[BTN_COUNT];

    while (true) {
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        for (int i = 0; i < BTN_COUNT; i++) {
            State &s = st[i];
            Button b = (Button)i;
            bool raw = button_down(b);
            if (raw == s.down) {
                s.raw_ms = 0;
            } else if ((s.raw_ms += POLL_MS) >= DEBOUNCE_MS) {
                s.down = raw;
                s.raw_ms = 0;
                if (s.down) {
                    s.held_ms = 0;
                    s.long_sent = false;
                } else if (!s.long_sent) {  // released: a short press
                    if (!double_enabled[i]) post(b, BTN_SHORT);
                    else if (s.pending_ms >= 0) {
                        s.pending_ms = -1;
                        post(b, BTN_DOUBLE);
                    } else s.pending_ms = 0;
                }
            }
            if (s.down && !s.long_sent && (s.held_ms += POLL_MS) >= LONG_MS) {
                s.long_sent = true;
                s.pending_ms = -1;
                post(b, BTN_LONG);
            }
            if (s.pending_ms >= 0 && !s.down && (s.pending_ms += POLL_MS) >= DOUBLE_MS) {
                s.pending_ms = -1;
                post(b, BTN_SHORT);
            }
        }
    }
}

void buttons_start() {
    for (const Pin &p : pins) {
        gpio_config_t cfg = {};
        cfg.pin_bit_mask = 1ULL << p.gpio;
        cfg.mode = GPIO_MODE_INPUT;
        cfg.pull_up_en = p.active_high ? GPIO_PULLUP_DISABLE : GPIO_PULLUP_ENABLE;
        cfg.pull_down_en = p.active_high ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE;
        gpio_config(&cfg);
    }
    events = xQueueCreate(8, sizeof(ButtonMessage));
    xTaskCreate(button_task, "buttons", 2048, nullptr, 4, nullptr);
}

bool buttons_wait(ButtonMessage &msg, uint32_t timeout_ms) { return xQueueReceive(events, &msg, pdMS_TO_TICKS(timeout_ms)) == pdTRUE; }

void buttons_enable_double(Button b, bool on) { double_enabled[b] = on; }
