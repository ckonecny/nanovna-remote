// SPDX-License-Identifier: GPL-3.0-or-later
#include "ui.h"

#include <functional>
#include <memory>
#include <string>
#include <vector>

#include "buttons.h"
#include "display.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "vna.h"
#include "wifi_mgr.h"
#include "wifi_setup.h"

namespace {

const int ROWS = 8;       // 8 rows of 16 px; the first is the title
const int ROW_Y0 = 3;     // (135 - 8 * 16) / 2 rounded down
const int COLS = DISPLAY_W / (GLYPH_W * 2);
const uint32_t IDLE_MS = 30000;  // back to the status screen after this long without a key

const uint16_t BLACK = rgb565(0, 0, 0), WHITE = rgb565(255, 255, 255), GREY = rgb565(130, 130, 130), CYAN = rgb565(0, 200, 230),
               GREEN = rgb565(80, 220, 100), ORANGE = rgb565(255, 160, 40), RED = rgb565(255, 90, 80), BLUE = rgb565(20, 70, 160),
               TITLE_BG = rgb565(0, 50, 90);

struct Row {
    std::string text;
    uint16_t fg = WHITE, bg = BLACK;
    bool operator==(const Row &o) const { return text == o.text && fg == o.fg && bg == o.bg; }
};

Row title_row(const std::string &t) { return {t, WHITE, TITLE_BG}; }
Row hint_row(const std::string &t) { return {t, GREY, BLACK}; }

struct Screen {
    virtual ~Screen() = default;
    virtual void rows(Row out[ROWS]) = 0;
    virtual void key(const ButtonMessage &m) = 0;
};

std::vector<std::shared_ptr<Screen>> stack;
// changes requested while a key is handled; applied afterwards so a screen is never destroyed under its own handler
std::vector<std::shared_ptr<Screen>> to_push;
int to_pop = 0;
bool to_root = false;

void push(std::shared_ptr<Screen> s) { to_push.push_back(std::move(s)); }
void pop() { to_pop++; }
void pop_to_root() { to_root = true; }

void apply_navigation() {
    while (to_pop > 0 && stack.size() > 1) {
        stack.pop_back();
        to_pop--;
    }
    to_pop = 0;
    if (to_root) stack.resize(1);
    to_root = false;
    for (auto &s : to_push) stack.push_back(s);
    to_push.clear();
}

// A list of lines to choose from. D0 up, D2 down, D1 short = on_ok, D1 long = on_long (default: back).
struct ListScreen : Screen {
    std::string title, hint;
    std::function<std::vector<std::string>()> items;
    std::function<void(int)> on_ok, on_long;
    int sel = 0;
    int top = 0;

    void rows(Row out[ROWS]) override {
        auto list = items();
        int n = list.size();
        if (sel >= n) sel = n ? n - 1 : 0;
        const int visible = ROWS - 2;
        if (sel < top) top = sel;
        if (sel >= top + visible) top = sel - visible + 1;
        out[0] = title_row(title);
        for (int i = 0; i < visible; i++) {
            int idx = top + i;
            if (idx >= n) {
                out[1 + i] = Row{};
                continue;
            }
            bool on = idx == sel;
            out[1 + i] = {(on ? "> " : "  ") + list[idx], on ? WHITE : GREY, on ? BLUE : BLACK};
        }
        out[ROWS - 1] = hint_row(hint);
    }

    void key(const ButtonMessage &m) override {
        int n = items().size();
        if (m.event == BTN_SHORT && m.button == BTN_D0 && n) sel = (sel + n - 1) % n;
        else if (m.event == BTN_SHORT && m.button == BTN_D2 && n) sel = (sel + 1) % n;
        else if (m.event == BTN_SHORT && m.button == BTN_D1 && n && on_ok) on_ok(sel);
        else if (m.event == BTN_LONG && m.button == BTN_D1) {
            if (on_long) on_long(sel);
            else pop();
        }
    }
};

std::shared_ptr<ListScreen> make_list(const std::string &title, const std::string &hint, std::function<std::vector<std::string>()> items,
                                      std::function<void(int)> ok, std::function<void(int)> longp = nullptr) {
    auto l = std::make_shared<ListScreen>();
    l->title = title;
    l->hint = hint;
    l->items = std::move(items);
    l->on_ok = std::move(ok);
    l->on_long = std::move(longp);
    return l;
}

std::string clip(const std::string &s) { return s.size() > (size_t)COLS ? s.substr(0, COLS) : s; }

void confirm_delete(size_t index, const std::string &ssid) {
    push(make_list(clip(ssid), "D1:ok long:back", [] { return std::vector<std::string>{"Keep", "Delete"}; },
                   [index](int i) {
                       if (i == 1) wifi_nets_remove(index);
                       pop();  // this question
                       pop();  // the options of the network
                   }));
}

void net_options(size_t index) {
    auto nets = wifi_nets_load();
    if (index >= nets.size()) return;
    std::string ssid = nets[index].ssid;
    push(make_list(clip(ssid), "D1:ok long:back",
                   [index] {
                       auto n = wifi_nets_load();
                       bool enabled = index < n.size() && n[index].enabled;
                       return std::vector<std::string>{"Connect", enabled ? "Disable" : "Enable", "Delete", "Back"};
                   },
                   [index, ssid](int i) {
                       switch (i) {
                           case 0:
                               wifi_mgr_connect(ssid);
                               pop_to_root();
                               break;
                           case 1: {
                               auto n = wifi_nets_load();
                               if (index < n.size()) wifi_nets_set_enabled(index, !n[index].enabled);
                               break;
                           }
                           case 2: confirm_delete(index, ssid); break;
                           default: pop();
                       }
                   }));
}

void wifi_list() {
    auto items = [] {
        std::vector<std::string> out;
        auto st = wifi_mgr_status();
        for (const WifiNet &n : wifi_nets_load()) {
            const char *mark = st.state == WIFI_STA && st.ssid == n.ssid ? "* " : n.enabled ? "  " : "- ";
            out.push_back(mark + clip(n.ssid).substr(0, COLS - 4));
        }
        out.push_back("[Setup WiFi]");
        return out;
    };
    push(make_list("Choose WiFi", "D1:ok long:more", items,
                   [](int i) {
                       auto nets = wifi_nets_load();
                       if ((size_t)i < nets.size()) wifi_mgr_connect(nets[i].ssid);
                       else wifi_mgr_open_ap();
                       pop_to_root();
                   },
                   [](int i) {
                       if ((size_t)i < wifi_nets_load().size()) net_options(i);
                       else pop();
                   }));
}

void main_menu() {
    push(make_list("Menu", "D1:ok long:back",
                   [] { return std::vector<std::string>{"Choose WiFi", "Start setup WiFi", "Rotate display", "Restart", "Back"}; },
                   [](int i) {
                       switch (i) {
                           case 0: wifi_list(); break;
                           case 1:
                               wifi_mgr_open_ap();
                               pop_to_root();
                               break;
                           case 2: ui_flipped_set(!ui_flipped_get()); display_set_flipped(ui_flipped_get()); break;
                           case 3: esp_restart(); break;
                           default: pop();
                       }
                   }));
}

struct StatusScreen : Screen {
    void rows(Row out[ROWS]) override {
        auto st = wifi_mgr_status();
        out[0] = title_row("NanoVNA Remote");
        switch (st.state) {
            case WIFI_STA:
                out[1] = {"WiFi connected", GREEN};
                out[2] = {clip(st.ssid), WHITE};
                out[3] = {st.ip, CYAN};
                out[4] = {"nanovna.local", GREY};
                break;
            case WIFI_AP:
                out[1] = {"Setup WiFi open", ORANGE};
                out[2] = {clip(st.ssid), WHITE};
                out[3] = {"PW nanovna-remote", WHITE};
                out[4] = {"http://192.168.4.1", CYAN};
                break;
            case WIFI_CONNECTING:
                out[1] = {"Connecting to", ORANGE};
                out[2] = {clip(st.ssid), WHITE};
                break;
            default:
                out[1] = {"Searching WiFi ...", ORANGE};
        }
        bool usb = vna_usb_attached();
        out[6] = {usb ? "USB: device found" : "USB: no device", usb ? GREEN : GREY};
        out[7] = hint_row("D1:WiFi long:Menu");
    }

    void key(const ButtonMessage &m) override {
        if (m.event == BTN_SHORT && m.button == BTN_D1) wifi_list();
        else if (m.event == BTN_LONG && m.button == BTN_D1) main_menu();
    }
};

void ui_task(void *) {
    Row shown[ROWS];
    bool drawn = false;
    uint32_t last_key = 0;
    bool flipped_seen = ui_flipped_get();
    while (true) {
        ButtonMessage m;
        if (buttons_wait(m, 250)) {
            last_key = xTaskGetTickCount() * portTICK_PERIOD_MS;
            stack.back()->key(m);
            apply_navigation();
        } else if (stack.size() > 1 && xTaskGetTickCount() * portTICK_PERIOD_MS - last_key > IDLE_MS) {
            pop_to_root();
            apply_navigation();
        }
        if (ui_flipped_get() != flipped_seen) {  // turned in the menu: repaint everything
            flipped_seen = ui_flipped_get();
            drawn = false;
        }
        Row now[ROWS];
        stack.back()->rows(now);
        for (int i = 0; i < ROWS; i++) {
            if (drawn && now[i] == shown[i]) continue;
            std::string line = now[i].text;
            line.resize(COLS, ' ');
            display_text(0, ROW_Y0 + i * 16, line.c_str(), now[i].fg, now[i].bg, 2);
            shown[i] = now[i];
        }
        if (!drawn) {
            display_fill(0, 0, DISPLAY_W, ROW_Y0, BLACK);
            display_fill(0, ROW_Y0 + ROWS * 16, DISPLAY_W, DISPLAY_H - ROW_Y0 - ROWS * 16, BLACK);
        }
        drawn = true;
    }
}

}  // namespace

void ui_start() {
    stack.push_back(std::make_shared<StatusScreen>());
    xTaskCreate(ui_task, "ui", 6144, nullptr, 3, nullptr);
}
