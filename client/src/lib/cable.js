// Cable measurements from the reflection of a cable whose far end is open or shorted.
// A lossless line of length l and velocity factor VF turns the reflection phase by -4 * pi * f * l / (c * VF) (there and back),
// so the slope of the unwrapped phase over frequency gives the delay; the magnitude gives the loss.

export const C = 299792458; // m/s

// sweeps for the cable view. The phase may turn by less than half a revolution between two points, which limits the
// longest cable (c * VF / (4 * step)): about 150 m for the long sweep and 20 m for the short one at VF 0.66.
export const CABLE_RANGES = {
    long: { start: 1e6, stop: 30e6, label: '1 – 30 MHz (cables up to about 150 m)', maxLength: 150 },
    short: { start: 1e6, stop: 200e6, label: '1 – 200 MHz (cables up to about 20 m)', maxLength: 20 },
};

// typical velocity factors of common coax cables
export const CABLE_TYPES = [
    { name: 'RG58', vf: 0.66 },
    { name: 'RG174', vf: 0.66 },
    { name: 'RG213', vf: 0.66 },
    { name: 'RG8X / Mini 8', vf: 0.78 },
    { name: 'H155', vf: 0.79 },
    { name: 'Aircell 7', vf: 0.83 },
    { name: 'LMR-400 / Ecoflex 10', vf: 0.85 },
    { name: 'RG59 (75 Ω)', vf: 0.66 },
];

// points: [{ freq, real, imag }] ascending in frequency. Returns the unwrapped phase in rad per point, or null for points too weak
// to have a trustworthy phase.
export function unwrapPhase(points, minMagnitude = 0.02) {
    const out = [];
    let prev = null, offset = 0;
    for (const p of points) {
        if (Math.hypot(p.real, p.imag) < minMagnitude) { out.push(null); continue; }
        let ph = Math.atan2(p.imag, p.real) + offset;
        if (prev !== null) {
            while (ph - prev > Math.PI) { ph -= 2 * Math.PI; offset -= 2 * Math.PI; }
            while (ph - prev < -Math.PI) { ph += 2 * Math.PI; offset += 2 * Math.PI; }
        }
        out.push(ph);
        prev = ph;
    }
    return out;
}

// least squares line phase = a + slope * f through the usable points
export function fitPhase(points, phases) {
    const xs = [], ys = [];
    points.forEach((p, i) => { if (phases[i] !== null) { xs.push(p.freq); ys.push(phases[i]); } });
    const n = xs.length;
    if (n < 5) return null;
    const mx = xs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    const slope = sxy / sxx, a = my - slope * mx;
    const rms = Math.sqrt(xs.reduce((s, x, i) => s + (ys[i] - (a + slope * x)) ** 2, 0) / n);
    return { slope, a, rms, n };
}

// one-way delay in seconds from the fitted slope (rad/Hz): the phase covers the way there and back
export const delayFromSlope = (slope) => -slope / (4 * Math.PI);

export const lengthFromDelay = (delay, vf) => delay * C * vf;
// Port extension length (m, rounded to the mm) that gives back exactly this delay at the velocity factor in use: the extension is
// stored as a length and turned into a delay with the same factor, so the factor cancels out.
export const portExtensionFromDelay = (delay, vf) => Math.round(lengthFromDelay(delay, vf) * 1000) / 1000;
export const velocityFactorFromDelay = (delay, length) => length / (delay * C);

// one-way loss in dB at every usable point: the reflection of an open or short end has the loss of the way there and back
export function lossPerPoint(points) {
    return points.map(p => {
        const m = Math.hypot(p.real, p.imag);
        return m > 0 ? { freq: p.freq, db: -20 * Math.log10(Math.min(m, 1)) / 2 } : null;
    }).filter(Boolean);
}

// all results of a sweep; length is the known length (m) for a velocity factor measurement, vf the factor for a length measurement
export function analyseCable(points, { vf, length, zero = 0 }) {
    if (points.length < 5) return null;
    const phases = unwrapPhase(points);
    const fit = fitPhase(points, phases);
    if (!fit) return null;
    const delay = delayFromSlope(fit.slope) - zero; // zero: delay of the NanoVNA itself
    if (!(delay > 0)) return { phases, fit, delay, loss: lossPerPoint(points), valid: false };
    return {
        phases, fit, delay, valid: true,
        length: lengthFromDelay(delay, vf),
        vf: length > 0 ? velocityFactorFromDelay(delay, length) : null,
        loss: lossPerPoint(points),
        good: fit.rms < 0.25, // rad: the phase is a straight line. A cable too long for the sweep aliases to a straight line too, so this cannot catch that
    };
}

// ---- characteristic impedance ----
// A line of impedance Z0 measures Zoc = Z0 * coth(g * l) with its far end open and Zsc = Z0 * tanh(g * l) shorted, whatever its
// length and loss, so Z0 = sqrt(Zoc * Zsc) at every frequency. Where one of the two is close to 0 or very large the product is
// ill-conditioned, so only points with both between Z_MIN and Z_MAX are used.
const Z_MIN = 3, Z_MAX = 3000; // ohm
const REF = 50; // ohm, the NanoVNA's system impedance

const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const csqrt = (a) => { // principal root
    const m = Math.hypot(a.re, a.im), re = Math.sqrt((m + a.re) / 2), im = Math.sqrt((m - a.re) / 2);
    return { re, im: a.im < 0 ? -im : im };
};

// impedance from the reflection coefficient: Z = REF * (1 + g) / (1 - g)
export function impedanceOf(p) {
    const dr = 1 - p.real, di = -p.imag, nr = 1 + p.real, ni = p.imag, d = dr * dr + di * di;
    if (d === 0) return null;
    return { re: REF * (nr * dr + ni * di) / d, im: REF * (ni * dr - nr * di) / d };
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

// open and short: sweeps of the same line over the same frequencies. Returns the median Z0 with the spread of the real part
// (a measure of how well the two sweeps agree), or null when too few points are usable.
export function analyseImpedance(open, short) {
    if (!open || !short || open.length !== short.length || open.length < 5) return null;
    const res = [], ims = [];
    open.forEach((po, i) => {
        const zo = impedanceOf(po), zs = impedanceOf(short[i]);
        if (!zo || !zs) return;
        const mo = Math.hypot(zo.re, zo.im), ms = Math.hypot(zs.re, zs.im);
        if (mo < Z_MIN || mo > Z_MAX || ms < Z_MIN || ms > Z_MAX) return;
        const z0 = csqrt(cmul(zo, zs));
        res.push(z0.re); ims.push(z0.im);
    });
    if (res.length < 5) return null;
    const re = median(res), dev = res.map(v => Math.abs(v - re));
    return { z0: re, imag: median(ims), spread: median(dev), n: res.length };
}

// ---- cut and stub lengths ----
export const wavelength = (freq, vf) => C * vf / freq;

// Length (m) of a stub that shows the reactance x (ohm, signed) at freq on a line of impedance z0 and velocity factor vf.
// Shorted: x = z0 * tan(b*l). Open: x = -z0 / tan(b*l). The shortest length is returned, always below half a wavelength.
export function stubLength({ freq, vf, x, z0, type }) {
    const b = 2 * Math.PI * freq / (C * vf);
    let angle = type === 'open' ? (x === 0 ? Math.PI / 2 : Math.atan(-z0 / x)) : Math.atan(x / z0);
    if (angle < 0) angle += Math.PI;
    return angle / b;
}

// Port extension: a line of delay tau (s) between the instrument and the device under test turns the reflection by
// -4 * pi * f * tau; turning it back by the same angle moves the reference plane to the end of the line.
export function portExtend(points, tau) {
    if (!tau) return points;
    return points.map((p) => {
        const a = 4 * Math.PI * p.freq * tau;
        const c = Math.cos(a), s = Math.sin(a);
        return { ...p, real: p.real * c - p.imag * s, imag: p.real * s + p.imag * c };
    });
}
