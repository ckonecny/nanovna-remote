// One-port open/short/load calibration computed in the app, per band, from raw (uncorrected) reflection measurements.
// Error model: gm = ed + er * g / (1 - es * g), the standards are ideal (open +1, short -1, load 0).
import { reactive, watch } from 'vue';

const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => {
    const d = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};

// raw measurements are arrays of [re, im] per frequency; returns the three error terms per frequency
export function solveOSL(open, short, load) {
    const ed = [], es = [], er = [];
    for (let i = 0; i < load.length; i++) {
        const d = load[i];
        const a = csub(open[i], d);  // er / (1 - es)
        const b = csub(short[i], d); // -er / (1 + es)
        const ab = csub(a, b);
        const s = cdiv(cadd(a, b), ab);
        ed.push(d);
        es.push(s);
        er.push(cdiv(cmul([-2, 0], cmul(a, b)), ab));
    }
    return { ed, es, er };
}

export function correctPoint(g, ed, es, er) {
    const v = csub(g, ed);
    return cdiv(v, cadd(er, cmul(es, v)));
}

// error terms at an arbitrary frequency inside the calibrated range (linear interpolation), or null outside
export function termsAt(cal, f) {
    const fr = cal.freqs;
    if (f < fr[0] || f > fr[fr.length - 1]) return null;
    let lo = 0, hi = fr.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (fr[mid] <= f) lo = mid; else hi = mid;
    }
    const t = hi === lo || fr[hi] === fr[lo] ? 0 : (f - fr[lo]) / (fr[hi] - fr[lo]);
    const mix = (arr) => [arr[lo][0] + t * (arr[hi][0] - arr[lo][0]), arr[lo][1] + t * (arr[hi][1] - arr[lo][1])];
    return { ed: mix(cal.ed), es: mix(cal.es), er: mix(cal.er) };
}

// corrects points {freq, real, imag}; returns { points, covered } where covered counts the corrected ones
export function applyCal(points, bands) {
    const cals = Object.values(bands);
    let covered = 0;
    const out = points.map((p) => {
        for (const cal of cals) {
            const t = termsAt(cal, p.freq);
            if (!t) continue;
            const [real, imag] = correctPoint([p.real, p.imag], t.ed, t.es, t.er);
            covered++;
            return { ...p, real, imag };
        }
        return p;
    });
    return { points: out, covered };
}

const KEY = 'nanovna-web-client-appcal';

function load() {
    const empty = { enabled: false, bands: {}, raw: {} };
    try {
        const saved = JSON.parse(localStorage.getItem(KEY));
        return saved ? { ...empty, ...saved } : empty;
    } catch (e) {
        return empty;
    }
}

// bands: name -> { freqs, ed, es, er }; raw: name -> { open, short, load } measured so far (kept until all three exist)
export const appCal = reactive(load());

watch(appCal, (v) => {
    try {
        localStorage.setItem(KEY, JSON.stringify(v));
    } catch (e) { /* storage full or blocked: the calibration just won't survive a reload */ }
}, { deep: true });

// ---- keeping the calibration on the ESP32 so that every browser/phone sees the same one ----

const round = (k, v) => (typeof v === 'number' ? +v.toPrecision(7) : v);
const url = (host) => `http://${host || location.host}/api/appcal`;

// device -> browser. The device's copy wins; a browser-only calibration is uploaded when the device has none.
export async function pullFromDevice(host) {
    if (import.meta.env.VITE_DEMO) return; // demo build: the calibration stays in this browser
    try {
        const res = await fetch(url(host));
        if (res.ok) {
            const saved = JSON.parse(await res.text());
            appCal.bands = saved.bands || {};
            appCal.raw = saved.raw || {};
            appCal.enabled = Object.keys(appCal.bands).length > 0;
        } else if (res.status === 404 && Object.keys(appCal.bands).length) {
            await pushToDevice(host);
        }
    } catch (e) { /* not talking to an ESP32 (or offline): the browser's copy is used */ }
}

export async function pushToDevice(host) {
    if (import.meta.env.VITE_DEMO) return;
    try {
        await fetch(url(host), { method: 'PUT', body: JSON.stringify({ bands: appCal.bands, raw: appCal.raw }, round) });
    } catch (e) { /* see above */ }
}
