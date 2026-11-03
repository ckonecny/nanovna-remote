// Marker readout: what the NanoVNA shows for a marker, computed from the corrected sweep.
import { impedanceOf } from './cable';

const REF = 50;

// index of the point nearest to freq
export function nearestIndex(points, freq) {
    let best = -1, dist = Infinity;
    for (let i = 0; i < points.length; i++) {
        const d = Math.abs(points[i].freq - freq);
        if (d < dist) { dist = d; best = i; }
    }
    return best;
}

// all values for one point. Q = |X| / R; the series circuit is R + L or R + C, the parallel one Rp || Lp or Cp.
export function readout(p) {
    const g = Math.hypot(p.real, p.imag);
    const z = impedanceOf(p);
    const w = 2 * Math.PI * p.freq;
    const out = {
        freq: p.freq,
        gamma: g,
        swr: g >= 1 ? Infinity : (1 + g) / (1 - g),
        rl: g > 0 ? -20 * Math.log10(g) : Infinity,
        phase: Math.atan2(p.imag, p.real) * 180 / Math.PI,
        r: null, x: null, q: null, ls: null, cs: null, rp: null, xp: null, lp: null, cp: null,
    };
    if (!z) return out;
    out.r = z.re; out.x = z.im;
    out.q = z.re > 0 ? Math.abs(z.im) / z.re : Infinity;
    if (w > 0 && z.im !== 0) {
        if (z.im > 0) out.ls = z.im / w; else out.cs = -1 / (w * z.im);
    }
    // parallel equivalent from the admittance Y = 1 / Z = G + jB
    const m = z.re * z.re + z.im * z.im;
    if (m > 0) {
        const gp = z.re / m, bp = -z.im / m;
        out.rp = gp > 0 ? 1 / gp : Infinity;
        out.xp = bp !== 0 ? -1 / bp : Infinity;
        if (w > 0 && bp !== 0) {
            if (bp < 0) out.lp = -1 / (w * bp); else out.cp = bp / w;
        }
    }
    return out;
}

// difference of two readouts (b - a) for the delta marker
export function delta(a, b) {
    const d = {};
    for (const k of ['freq', 'gamma', 'swr', 'rl', 'phase', 'r', 'x']) {
        const v = a[k] === null || b[k] === null ? null : b[k] - a[k];
        d[k] = Number.isFinite(v) ? v : null;
    }
    return d;
}

// 'min' or 'max' of value(point) over the sweep; returns the frequency of that point, or null
export function search(points, value, kind) {
    let best = null, bv = kind === 'min' ? Infinity : -Infinity;
    for (const p of points) {
        const v = value(p);
        if (!Number.isFinite(v)) continue;
        if (kind === 'min' ? v < bv : v > bv) { bv = v; best = p.freq; }
    }
    return best;
}

// compact engineering notation: 4.7 nH, 12.3 pF
export function eng(v, unit, digits = 3) {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    if (!Number.isFinite(v)) return '∞ ' + unit;
    if (v === 0) return '0 ' + unit;
    const prefixes = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    const a = Math.abs(v);
    const [s, p] = prefixes.find(([m]) => a >= m * 0.9995) || prefixes[prefixes.length - 1];
    return (v / s).toPrecision(digits) + ' ' + p + unit;
}

export { REF };
