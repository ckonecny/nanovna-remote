import { calcSWR, calcLogMag, calcZ, calcLinear, calcPhase, calcQ, calcRp, calcXp } from './dsp';

// Pure helpers of the single-frequency log: thinning, drawing, scales, CSV. A log point holds the raw reading only:
// { t (ms since 1970), f (Hz), re, im } (the reflection coefficient, with the app calibration and port extension applied as
// in the other views). Every format is worked out from it when it is drawn or exported, so any of them can be chosen afterwards.

export const LOG_MAX = 20000; // above this the log is thinned and the interval doubled
export const LOG_INTERVALS = [[0, 'Every reading'], [1000, '1 s'], [5000, '5 s'], [30000, '30 s'], [60000, '1 min']];
export const LOG_WINDOWS = [[0, 'All'], [60, '1 min'], [600, '10 min'], [3600, '1 h']]; // seconds shown, 0 = everything

const gam = (p) => ({ freq: p.f, real: p.re, imag: p.im });
const zOf = (p) => calcZ(gam(p));
// What the log chart can draw: per format its series (value of a point, line class, label), the largest value drawn (a short circuit or an
// open end must not stretch the axis), the narrowest range shown (a nearly constant value stays a calm line) and a unit.
export const LOG_FORMATS = {
    swr: { label: 'SWR', title: 'SWR', unit: '', min: 1, max: 10, span: 0.4, series: [{ cls: 'curve', name: 'SWR', get: p => calcSWR(gam(p)) }] },
    rl: { label: 'Return loss', title: 'Return loss (dB)', unit: 'dB', max: 60, span: 4, series: [{ cls: 'curve', name: 'RL', get: p => -calcLogMag(gam(p)) }] },
    rx: { label: 'R / X', title: 'R (blue) / X (orange) in Ω', unit: 'Ω', max: 1000, span: 20, series: [{ cls: 'curve', name: 'R', get: p => zOf(p)[0] }, { cls: 'curve-x', name: 'X', get: p => zOf(p)[1] }] },
    z: { label: '|Z|', title: '|Z| in Ω', unit: 'Ω', max: 1000, span: 20, series: [{ cls: 'curve', name: '|Z|', get: p => Math.hypot(...zOf(p)) }] },
    rpxp: { label: 'Rp / Xp', title: 'Rp (blue) / Xp (orange) in Ω', unit: 'Ω', max: 1000, span: 20, series: [{ cls: 'curve', name: 'Rp', get: p => calcRp(gam(p)) }, { cls: 'curve-x', name: 'Xp', get: p => calcXp(gam(p)) }] },
    q: { label: 'Q', title: 'Q', unit: '', min: 0, max: 100, span: 2, series: [{ cls: 'curve', name: 'Q', get: p => calcQ(gam(p)) }] },
    gamma: { label: '|Γ|', title: '|Γ|', unit: '', min: 0, max: 1, span: 0.1, series: [{ cls: 'curve', name: '|Γ|', get: p => calcLinear(gam(p)) }] },
    phase: { label: 'Phase', title: 'Phase of Γ (°)', unit: '°', span: 10, series: [{ cls: 'curve', name: 'Phase', get: p => calcPhase(gam(p)) }] },
};

// value of one series, within the largest value the format draws (and the smallest, when it has one: SWR never below 1)
export function plotValue(format, series, p) {
    const f = LOG_FORMATS[format];
    const v = series.get(p);
    if (!isFinite(v)) return v === Infinity && f.max !== undefined ? f.max : NaN;
    if (f.max === undefined) return v;
    return Math.max(f.min !== undefined ? f.min : -f.max, Math.min(v, f.max));
}

// all values of a point, for the readout and the CSV
export function derive(p) {
    const g = gam(p), [r, x] = zOf(p);
    return { swr: calcSWR(g), rl: -calcLogMag(g), r, x, z: Math.hypot(r, x), rp: calcRp(g), xp: calcXp(g), q: calcQ(g), gamma: calcLinear(g), phase: calcPhase(g) };
}

// Drops every second point (the newest one stays) and returns the new interval: at least twice the old one and at least twice
// the real spacing of what is left, so that "every reading" (0) gets a real value as well.
export function thin(points, intervalMs) {
    if (points.length < 3) return { points, intervalMs };
    const last = points.length - 1;
    const kept = points.filter((p, i) => i % 2 === 0 || i === last);
    const spacing = (points[last].t - points[0].t) / last;
    return { points: kept, intervalMs: Math.max(intervalMs * 2, Math.round(spacing * 2)) };
}

// At most `buckets` * 2 points for drawing: per time bucket the lowest and the highest value of `get`, so that a spike
// stays visible. Returns points in time order; fewer points than that are returned as they are.
export function downsample(points, get, buckets) {
    if (points.length <= buckets * 2) return points;
    const t0 = points[0].t;
    const span = points[points.length - 1].t - t0 || 1;
    const lo = new Array(buckets).fill(null);
    const hi = new Array(buckets).fill(null);
    for (const p of points) {
        const v = get(p);
        if (!isFinite(v)) continue;
        const b = Math.min(buckets - 1, Math.floor((p.t - t0) / span * buckets));
        if (lo[b] === null || v < get(lo[b])) lo[b] = p;
        if (hi[b] === null || v > get(hi[b])) hi[b] = p;
    }
    const out = [];
    for (let b = 0; b < buckets; b++) {
        if (lo[b] === null) continue;
        out.push(...(lo[b] === hi[b] ? [lo[b]] : [lo[b], hi[b]].sort((a, c) => a.t - c.t)));
    }
    return out;
}

// the points of the last `seconds` seconds of the log (0 = all)
export function inWindow(points, seconds) {
    if (!seconds || !points.length) return points;
    const from = points[points.length - 1].t - seconds * 1000;
    let i = points.length;
    while (i > 0 && points[i - 1].t >= from) i--;
    return points.slice(i);
}

// A rounded axis around [min, max] with about `n` ticks: { lo, hi, ticks, decimals }. A range narrower than `minSpan` is widened
// around its middle, so that a nearly constant value stays a calm line instead of a magnified wiggle.
export function niceScale(min, max, n = 4, minSpan = 0) {
    if (!isFinite(min) || !isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1], decimals: 0 };
    const span = Math.max(max - min, minSpan, 1e-9);
    const mid = (min + max) / 2;
    if (max - min < span) { min = mid - span / 2; max = mid + span / 2; }
    const raw = (max - min) / n;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-12);
    const lo = Math.floor(min / step + 1e-9) * step;
    const hi = Math.ceil(max / step - 1e-9) * step;
    let decimals = 0; // as many as the step needs, so that no two ticks read the same
    while (decimals < 6 && Math.abs(step * 10 ** decimals - Math.round(step * 10 ** decimals)) > 1e-6) decimals++;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo, hi, ticks, decimals };
}

const two = (n) => String(n).padStart(2, '0');
// clock label of an axis tick: seconds only for a short log, the date as well once it spans more than a day
export function clockLabel(t, spanMs) {
    const d = new Date(t);
    const clock = two(d.getHours()) + ':' + two(d.getMinutes()) + (spanMs < 600000 ? ':' + two(d.getSeconds()) : '');
    return spanMs > 86400000 ? two(d.getDate()) + '.' + two(d.getMonth() + 1) + ' ' + clock : clock;
}

// "1 h 05 min", "3 min 20 s", "45 s": how long a log runs
export function durationText(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + two(s % 60) + ' s';
    return Math.floor(s / 3600) + ' h ' + two(Math.floor(s % 3600 / 60)) + ' min';
}

// CSV of the log for a spreadsheet: ISO time, seconds since the first point, frequency, the raw reflection and every format
export function toCsv(points) {
    const t0 = points.length ? points[0].t : 0;
    const num = (v, d) => (isFinite(v) ? v.toFixed(d) : '');
    const rows = ['time,elapsed_s,freq_hz,gamma_re,gamma_im,swr,return_loss_db,r_ohm,x_ohm,z_ohm,rp_ohm,xp_ohm,q,gamma_mag,phase_deg'];
    for (const p of points) {
        const d = derive(p);
        rows.push([new Date(p.t).toISOString(), ((p.t - t0) / 1000).toFixed(3), Math.round(p.f), p.re.toFixed(6), p.im.toFixed(6),
            num(d.swr, 4), num(d.rl, 3), num(d.r, 3), num(d.x, 3), num(d.z, 3), num(d.rp, 3), num(d.xp, 3), num(d.q, 3), num(d.gamma, 5), num(d.phase, 2)].join(','));
    }
    return rows.join('\n') + '\n';
}

// ---- storage format: one Float64Array per column keeps a 20,000 point log at about 0.6 MB ----
const COLUMNS = ['t', 'f', 're', 'im'];

export function pack(points) {
    const out = {};
    for (const c of COLUMNS) out[c] = Float64Array.from(points, p => p[c]);
    return out;
}

export function unpack(cols) {
    if (!cols || !COLUMNS.every(c => cols[c] && typeof cols[c].length === 'number')) return [];
    const n = cols.t.length;
    if (!COLUMNS.every(c => cols[c].length === n)) return [];
    return Array.from({ length: n }, (_, i) => Object.fromEntries(COLUMNS.map(c => [c, cols[c][i]])));
}
