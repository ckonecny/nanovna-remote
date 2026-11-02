// Time-domain reflectometry from a one-port sweep: the sweep is read as a low-pass response and transformed to time with a window,
// then time is turned into distance with the cable's velocity factor.
import { C } from './cable';

// The sweep must sit on a harmonic grid (start = step, stop = 101 * start) so that it is a proper low-pass spectrum.
// The round-trip time is unambiguous up to 1 / step, which gives the range; the resolution follows from the bandwidth.
export const TDR_RANGES = {
    short: { start: 3e6, stop: 303e6 },
    medium: { start: 1e6, stop: 101e6 },
    long: { start: 0.3e6, stop: 30.3e6 },
};

// range (m) and resolution (m) of a sweep at a velocity factor (the window widens the main lobe by about 1.5)
export function describeRange(range, vf) {
    const v = C * vf, step = (range.stop - range.start) / 100;
    return { range: v / (2 * step), resolution: 1.5 * v / (2 * (range.stop - range.start + step)) };
}

// points: [{ freq, real, imag }] ascending. Returns distances (m) and the impulse response (the peak of an isolated reflection is
// about its reflection coefficient). There is no step response: it needs the reflection at 0 Hz, which the NanoVNA cannot
// measure and which cannot be estimated from the first point of a sweep (its phase has already turned by up to a full circle).
export function computeTdr(points, vf, oversample = 4) {
    const n = points.length;
    if (n < 8) return null;
    const df = (points[n - 1].freq - points[0].freq) / (n - 1);
    if (!(df > 0)) return null;
    // the DC term is left out (zero), which only removes a constant from the response
    const freq = [0, ...points.map(p => p.freq)];
    const re = [0, ...points.map(p => p.real)];
    const im = [0, ...points.map(p => p.imag)];
    const m = freq.length;
    const w = freq.map((_, k) => 0.54 + 0.46 * Math.cos(Math.PI * k / (m - 1))); // falling half of a Hamming window
    const norm = w[0] + 2 * w.slice(1).reduce((a, v) => a + v, 0);
    const T = 1 / df; // round trip time that is covered
    const M = oversample * 2 * (m - 1);
    const dt = T / M;
    const v = C * vf;
    const dist = [], impulse = [];
    for (let i = 0; i < M; i++) {
        const t = i * dt;
        let sum = w[0] * re[0];
        for (let k = 1; k < m; k++) {
            const a = 2 * Math.PI * freq[k] * t;
            sum += 2 * w[k] * (re[k] * Math.cos(a) - im[k] * Math.sin(a));
        }
        impulse.push(sum / norm);
        dist.push(t * v / 2);
    }
    // the response repeats every `range`: the NanoVNA's own delay puts the connector a little before 0 m, which shows up at the far
    // end. Move that last stretch in front of 0 m, as negative distances.
    const resolution = describeRange({ start: points[0].freq, stop: points[n - 1].freq }, vf).resolution;
    const range = v / (2 * df);
    const cut = dist.findIndex(d => d > range - 4 * resolution);
    if (cut > 0) {
        const tail = dist.splice(cut), tailImpulse = impulse.splice(cut);
        dist.unshift(...tail.map(d => d - range));
        impulse.unshift(...tailImpulse);
    }
    return { dist, impulse, resolution };
}

// strongest reflection beyond the first bit of the sweep (the connector sits at distance 0): { dist, value, kind }
export function strongestReflection(tdr, minDist = 0) {
    let best = -1;
    for (let i = 0; i < tdr.dist.length; i++) {
        if (tdr.dist[i] < minDist) continue;
        if (best < 0 || Math.abs(tdr.impulse[i]) > Math.abs(tdr.impulse[best])) best = i;
    }
    if (best < 0) return null;
    const value = tdr.impulse[best];
    return { dist: tdr.dist[best], value, kind: value >= 0 ? 'open or higher impedance' : 'short or lower impedance' };
}
