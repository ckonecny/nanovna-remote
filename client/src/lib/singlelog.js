import { reactive, watch } from 'vue';
import { store } from '../store';
import { LOG_MAX, thin, pack, unpack } from './tracelog';
import { loadLog, saveLog, clearLog } from './logdb';

// The log of the Single view: one point per reading (or per interval) of the chosen frequency, kept in the browser. The points
// are a plain array, outside the reactive state: with tens of thousands of points a deep proxy would cost more than it gives.
// `slog.version` changes with every change of the points, and the chart redraws on it.
export const slog = reactive({
    running: false,
    intervalMs: 1000, // time between two points; 0 = every reading of the device
    count: 0,
    startedAt: 0, // time of the first point
    version: 0,
    raisedFrom: 0, // interval (ms) before the log was thinned the first time, 0 when it never was
    stored: true, // false once the browser refused to store the log
});

let points = [];
let lastAt = 0;
let dirty = false;
export const logPoints = () => points;

const touch = () => { slog.count = points.length; slog.version++; dirty = true; };

// a reading counts when the Single view is open and the point of the sweep is the chosen frequency (the sweep is centred on it)
function sample() {
    if (!slog.running || !store.singleActive || store.calibrationRunning) return;
    const data = store.data.ch0;
    if (!data.length) return;
    const now = Date.now();
    if (slog.intervalMs > 0 && now - lastAt < slog.intervalMs) return;
    const p = data.reduce((a, b) => (Math.abs(b.freq - store.singleFreq) < Math.abs(a.freq - store.singleFreq) ? b : a));
    if (Math.abs(p.freq - store.singleFreq) > 1500) return; // the sweep still has the range of another view
    points.push({ t: now, f: p.freq, re: p.real, im: p.imag });
    lastAt = now;
    if (points.length > LOG_MAX) {
        // too many points: drop every second one and sample half as often from now on, so the log can run for ever
        if (!slog.raisedFrom) slog.raisedFrom = slog.intervalMs;
        const t = thin(points, slog.intervalMs);
        points = t.points;
        slog.intervalMs = t.intervalMs;
    }
    if (!slog.startedAt) slog.startedAt = points[0].t;
    touch();
}

watch(() => store.dataVersion, sample);

export function startLog() {
    slog.running = true;
    lastAt = 0;
}

export function stopLog() {
    slog.running = false;
    save();
}

export function setLogInterval(ms) {
    slog.intervalMs = ms;
    slog.raisedFrom = 0;
    dirty = true;
}

export async function clearAll() {
    slog.running = false;
    points = [];
    slog.startedAt = 0;
    slog.raisedFrom = 0;
    touch();
    dirty = false;
    await clearLog();
}

export async function save() {
    if (!dirty) return;
    dirty = false;
    slog.stored = await saveLog({ startedAt: slog.startedAt, intervalMs: slog.intervalMs, raisedFrom: slog.raisedFrom, cols: pack(points) });
}

async function restore() {
    const rec = await loadLog();
    if (!rec || points.length) return; // nothing saved, or the user has already started a new log
    points = unpack(rec.cols);
    slog.startedAt = points.length ? points[0].t : 0;
    if (rec.intervalMs >= 0) slog.intervalMs = rec.intervalMs;
    slog.raisedFrom = rec.raisedFrom || 0;
    slog.count = points.length;
    slog.version++;
}

// saved every few seconds while it runs, and when the page goes into the background or is closed
if (typeof window !== 'undefined') {
    setInterval(() => { if (slog.running) save(); }, 10000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    window.addEventListener('pagehide', save);
    restore();
}
