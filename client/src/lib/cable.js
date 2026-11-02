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
