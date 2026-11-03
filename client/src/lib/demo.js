// Demo mode (build:demo, hosted on GitHub Pages): a simulated NanoVNA inside the page instead of the ESP32 bridge.
// DemoSocket stands in for the WebSocket and speaks the NanoVNA text shell; the readings are modelled, not measured.
// The raw readings carry error terms, so the app's own open/short/load calibration works on them like on a real device.
// Which device is connected is chosen in the page (DemoPanel.vue) and reaches the worker through a BroadcastChannel.
// Same models as dev-tools/simulator.py (keep them in step).

export const DUTS = [
    ['antenna', 'Antenna (a resonance in every ham band)'],
    ['open', 'Open standard'],
    ['short', 'Short standard'],
    ['load', 'Load standard'],
    ['cable-open', 'Coax cable 25 m, far end open'],
    ['cable-short', 'Coax cable 25 m, far end shorted'],
    ['cable-fault', 'Coax cable 25 m with a damaged spot at 12 m'],
];
export const DEMO_CHANNEL = 'nanovna-demo';

const C0 = 299792458.0;
const BANDS = [[1.81e6, 2.0e6], [3.5e6, 3.8e6], [5.3515e6, 5.3665e6], [7.0e6, 7.2e6], [10.1e6, 10.15e6], [14.0e6, 14.35e6],
    [18.068e6, 18.168e6], [21.0e6, 21.45e6], [24.89e6, 24.99e6], [28.0e6, 29.7e6], [50e6, 52e6], [70e6, 70.5e6],
    [144e6, 146e6], [430e6, 440e6]];
// resonance position inside the band (fraction), feed resistance and Q: a little different in every band
const RES = [[0.55, 46, 14], [0.35, 58, 9], [0.50, 52, 40], [0.42, 49, 18], [0.60, 44, 60], [0.38, 53, 25], [0.55, 61, 55],
    [0.45, 47, 20], [0.50, 51, 70], [0.30, 55, 12], [0.60, 43, 16], [0.50, 50, 45], [0.40, 57, 30], [0.52, 48, 8]];

// ---- complex numbers as [re, im] ----
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const exp = (a) => [Math.exp(a[0]) * Math.cos(a[1]), Math.exp(a[0]) * Math.sin(a[1])];
const scale = (a, k) => [a[0] * k, a[1] * k];
const polar = (r, phi) => [r * Math.cos(phi), r * Math.sin(phi)];
const tanh = (a) => {
    const e = exp(scale(a, 2));
    return div(sub(e, [1, 0]), add(e, [1, 0]));
};
const gammaOfZ = (z, z0 = 50) => div([z[0] - z0, z[1]], [z[0] + z0, z[1]]);

function errorTerms(f) {
    const ed = polar(0.045, 0.4 + f / 9e7);
    const es = polar(0.07, -0.9 + f / 2.5e8);
    const er = polar(0.93 * (1 + 0.02 * Math.sin(f / 4e7)), -2 * Math.PI * f * 0.8e-9);
    return [ed, es, er];
}

function antenna(f) {
    let i = 0, best = Infinity;
    BANDS.forEach(([a, b], k) => {
        const d = Math.abs(Math.log(f / Math.sqrt(a * b)));
        if (d < best) { best = d; i = k; }
    });
    const [a, b] = BANDS[i];
    const [frac, r, q] = RES[i];
    const f0 = a + frac * (b - a);
    return gammaOfZ([r, r * q * (f / f0 - f0 / f)]);
}

// propagation constant of a lossy cable (about RG-58) and its characteristic impedance
function coax(f, vf = 0.66, z0 = 51) {
    const alpha = 0.148 * Math.sqrt(f / 1e8) / 8.686;
    return [[alpha, 2 * Math.PI * f / (C0 * vf)], z0];
}

function cable(f, end, fault, length = 25) {
    const [g, z0] = coax(f);
    const t = tanh(scale(g, length));
    // input impedance of the line, then the reflection against 50 ohm
    const zin = end === 'open' ? div([z0, 0], t) : mul([z0, 0], t);
    let gam = gammaOfZ(zin);
    if (fault) {
        const [d, gf] = fault;
        // a partial reflection at distance d adds an echo; what passes on is reduced
        gam = add(mul([gf, 0], exp(scale(g, -2 * d))), mul([1 - gf * gf, 0], gam));
    }
    return gam;
}

function reflection(dut, f) {
    switch (dut) {
        case 'antenna': return antenna(f);
        case 'open': return [1, 0];
        case 'short': return [-1, 0];
        case 'load': return polar(0.012 * Math.sqrt(f / 1e8), 0.7 + f / 3e8); // slightly imperfect
        case 'cable-open': return cable(f, 'open');
        case 'cable-short': return cable(f, 'short');
        case 'cable-fault': return cable(f, 'open', [12, -0.25]);
        default: return [0, 0];
    }
}

const gauss = (sigma) => sigma * Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

class Vna {
    constructor() {
        this.dut = 'antenna';
        this.start = 50000;
        this.stop = 900000000;
        this.points = 101;
        this.slots = {};
        this.sweepSettings = { bandwidth: 3, smooth: 0, power: 255 };
    }

    freqs() {
        const n = this.points;
        return Array.from({ length: n }, (_, i) => Math.trunc(this.start + (this.stop - this.start) * i / (n - 1)));
    }

    data(ch) {
        return this.freqs().map((f) => {
            let gm;
            if (ch === 0) {
                const [ed, es, er] = errorTerms(f);
                const g = reflection(this.dut, f);
                gm = add(ed, div(mul(er, g), sub([1, 0], mul(es, g))));
            } else {
                gm = polar(0.0002, f / 5e6); // nothing connected between the ports
            }
            gm = add(gm, [gauss(6e-5), gauss(6e-5)]);
            return `${gm[0].toFixed(6)} ${gm[1].toFixed(6)}`;
        });
    }

    // a simple picture of the NanoVNA's screen: graticule and the log-magnitude trace (RGB565, big endian)
    capture() {
        const w = 320, h = 240;
        const px = new Uint16Array(w * h);
        const put = (x, y, c) => { if (x >= 0 && x < w && y >= 0 && y < h) px[y * w + x] = c; };
        for (let i = 0; i <= 300; i += 30) for (let y = 20; y < 220; y++) put(10 + i, y, 0x3186);
        for (let j = 0; j <= 200; j += 25) for (let x = 10; x <= 310; x++) put(x, 20 + j, 0x3186);
        let prev = null;
        this.data(0).forEach((line, i) => {
            const [re, im] = line.split(' ').map(Number);
            const db = 20 * Math.log10(Math.max(Math.hypot(re, im), 1e-4));
            const x = 10 + Math.trunc(i * 300 / Math.max(this.points - 1, 1));
            const y = Math.trunc(20 + (-db) * 5);
            if (prev) {
                const n = Math.max(Math.abs(y - prev[1]), 1);
                for (let k = 0; k <= n; k++) put(x, Math.min(Math.max(prev[1] + Math.trunc((y - prev[1]) * k / n), 20), 219), 0x07E0);
            }
            prev = [x, y];
        });
        const out = new Uint8Array(w * h * 2);
        px.forEach((p, i) => { out[2 * i] = p >> 8; out[2 * i + 1] = p & 255; });
        return out;
    }

    // the reply (Uint8Array) to one shell command, without the echo and the prompt
    handle(line) {
        const enc = (s) => new TextEncoder().encode(s);
        const parts = line.trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return enc('');
        const [cmd, ...args] = parts;
        if (cmd === 'version') return enc('1.2.0\r\n');
        if (cmd === 'info') return enc('Kernel: simulator\r\nBoard: NanoVNA-H (simulated)\r\nVersion: 1.2.0\r\nPlatform: simulated\r\n');
        if (cmd === 'bandwidth' || cmd === 'smooth' || cmd === 'power') {
            if (args.length) this.sweepSettings[cmd] = parseInt(args[0], 10);
            const v = this.sweepSettings[cmd];
            if (cmd === 'bandwidth') return enc(`bandwidth ${v} (${Math.round(4000 / (v + 1))}Hz)\r\n`);
            return enc(args.length ? '' : cmd === 'smooth' ? `usage: smooth {0-8}\r\ncurrent: ${v}\r\n` : `usage: power {0-3}|{255 - auto}\r\npower: ${v}\r\n`);
        }
        if (cmd === 'frequencies') return enc(this.freqs().join('\r\n') + '\r\n');
        if (cmd === 'data') return enc(this.data(args.length ? parseInt(args[0], 10) : 0).join('\r\n') + '\r\n');
        if (cmd === 'sweep' && args.length === 2) {
            const v = Math.trunc(Number(args[1]));
            const c = Math.trunc((this.start + this.stop) / 2);
            if (args[0] === 'start') this.start = v;
            else if (args[0] === 'stop') this.stop = v;
            else if (args[0] === 'center') { this.start += v - c; this.stop += v - c; }
            else if (args[0] === 'span') { this.start = c - Math.trunc(v / 2); this.stop = c + Math.trunc(v / 2); }
            if (this.stop < this.start) this.stop = this.start;
            return enc('');
        }
        if (cmd === 'scan' && args.length >= 3) {
            this.start = parseInt(args[0], 10);
            this.stop = parseInt(args[1], 10);
            this.points = Math.max(2, parseInt(args[2], 10));
            if (args.length < 4) return enc('');
            const mask = parseInt(args[3], 10); // bit 0: frequency, bit 1: channel 0, bit 2: channel 1
            const cols = [];
            if (mask & 1) cols.push(this.freqs().map(String));
            for (const c of [0, 1]) if (mask & (2 << c)) cols.push(this.data(c));
            return enc(cols[0].map((_, i) => cols.map((col) => col[i]).join(' ')).join('\r\n') + '\r\n');
        }
        if (cmd === 'scan_bin' && args.length >= 4) {
            this.start = parseInt(args[0], 10);
            this.stop = parseInt(args[1], 10);
            this.points = Math.max(2, parseInt(args[2], 10));
            const mask = parseInt(args[3], 10);
            const freqs = this.freqs();
            const cols = [0, 1].filter((c) => mask & (2 << c)).map((c) => this.data(c));
            const size = (mask & 1 ? 4 : 0) + 8 * cols.length;
            const out = new Uint8Array(4 + size * freqs.length);
            const view = new DataView(out.buffer);
            view.setUint16(0, 0x80 | mask, true);
            view.setUint16(2, freqs.length, true);
            freqs.forEach((f, i) => {
                let o = 4 + i * size;
                if (mask & 1) { view.setUint32(o, f, true); o += 4; }
                for (const col of cols) {
                    const [re, im] = col[i].split(' ').map(Number);
                    view.setFloat32(o, re, true);
                    view.setFloat32(o + 4, im, true);
                    o += 8;
                }
            });
            return out;
        }
        if (cmd === 'save' && args.length) { this.slots[args[0]] = [this.start, this.stop, this.points]; return enc(''); }
        if (cmd === 'recall' && args.length) {
            [this.start, this.stop, this.points] = this.slots[args[0]] || [50000, 900000000, 101];
            return enc('');
        }
        if (cmd === 'capture') return this.capture();
        return enc(''); // resume, pause, cal, freq, port ... have no output
    }
}

// Stands in for the WebSocket of NanoVNA_WebSocket: bytes written to it are shell input, the replies come back as messages.
export class DemoSocket {
    constructor() {
        this.readyState = 0;
        this.binaryType = 'arraybuffer';
        this.vna = new Vna();
        this.line = '';
        this.channel = new BroadcastChannel(DEMO_CHANNEL);
        this.channel.onmessage = (e) => { if (e.data && e.data.dut) this.vna.dut = e.data.dut; };
        this.channel.postMessage({ hello: true }); // the page answers with the device chosen so far
        setTimeout(() => {
            this.readyState = 1;
            if (this.onopen) this.onopen();
        }, 0);
    }

    send(data) {
        const text = typeof data === 'string' ? data : new TextDecoder('latin1').decode(data);
        for (const ch of text) {
            if (ch !== '\r') { this.line += ch; continue; }
            const echo = new TextEncoder().encode(this.line + '\r\n');
            const reply = this.vna.handle(this.line);
            const prompt = new TextEncoder().encode('ch> ');
            const out = new Uint8Array(echo.length + reply.length + prompt.length);
            out.set(echo);
            out.set(reply, echo.length);
            out.set(prompt, echo.length + reply.length);
            this.line = '';
            setTimeout(() => { if (this.onmessage) this.onmessage({ data: out.buffer }); }, 0);
        }
    }

    close() {
        this.readyState = 3;
        this.channel.close();
        if (this.onclose) this.onclose();
    }
}
