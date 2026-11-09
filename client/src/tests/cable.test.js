import { describe, it, expect } from 'vitest';
import { analyseCable, portExtend, portExtensionFromDelay, C, CABLE_RANGES } from '../lib/cable';

// reflection of an open-ended line of length l (m), velocity factor vf and one-way loss (dB at 1 MHz, growing with sqrt(f))
const line = (l, vf, { loss = 0, range = CABLE_RANGES.long } = {}) => {
    const pts = [];
    for (let i = 0; i < 101; i++) {
        const f = range.start + (range.stop - range.start) * i / 100;
        const mag = 10 ** (-2 * loss * l / 100 * Math.sqrt(f / 1e6) / 20);
        const ph = -4 * Math.PI * f * l / (C * vf);
        pts.push({ freq: f, real: mag * Math.cos(ph), imag: mag * Math.sin(ph) });
    }
    return pts;
};

describe('cable', () => {
    it('recovers length from the velocity factor', () => {
        const r = analyseCable(line(23.4, 0.66), { vf: 0.66, length: 0 });
        expect(r.length).toBeCloseTo(23.4, 2);
        expect(r.good).toBe(true);
    });

    it('recovers the velocity factor from the length', () => {
        const r = analyseCable(line(10, 0.83, { range: CABLE_RANGES.short }), { vf: 0.66, length: 10 });
        expect(r.vf).toBeCloseTo(0.83, 3);
    });

    it('measures the loss of the one-way path', () => {
        const r = analyseCable(line(50, 0.66, { loss: 2 }), { vf: 0.66, length: 0 });
        const at4 = r.loss.find(p => Math.abs(p.freq - 4e6) < 1e5) || r.loss[0];
        expect(at4.db).toBeCloseTo(2 * 50 / 100 * Math.sqrt(at4.freq / 1e6), 2);
    });

    it('flags a reflection whose phase is not a straight line', () => {
        let seed = 7;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const pts = line(10, 0.66).map(p => { const ph = rnd() * 2 * Math.PI; return { freq: p.freq, real: Math.cos(ph), imag: Math.sin(ph) }; });
        const r = analyseCable(pts, { vf: 0.66, length: 0 });
        expect(r.valid === false || r.good === false).toBe(true);
    });
});

describe('cable zero', () => {
    it('subtracts the delay of the device itself', () => {
        const withOffset = line(10, 0.66).map(p => {
            const ph = Math.atan2(p.imag, p.real) - 4 * Math.PI * p.freq * 2e-9; // 2 ns of own delay
            return { freq: p.freq, real: Math.cos(ph), imag: Math.sin(ph) };
        });
        const r = analyseCable(withOffset, { vf: 0.66, length: 0, zero: 2e-9 });
        expect(r.length).toBeCloseTo(10, 2);
    });

    it('measured feedline delay gives a port extension that removes the line from an open end', () => {
        const vf = 0.66, l = 7.3;
        const r = analyseCable(line(l, vf), { vf, length: 0 });
        const ext = portExtensionFromDelay(r.delay, vf);
        expect(ext).toBeCloseTo(l, 2);
        // the same line used as feedline: the reflection of the open end turned back is 1 + 0j at every frequency
        const back = portExtend(line(l, vf), ext / (C * vf));
        for (const p of back) { expect(p.real).toBeCloseTo(1, 2); expect(p.imag).toBeCloseTo(0, 2); }
    });

    it('the extension does not depend on the velocity factor assumed', () => {
        const l = 7.3, vf = 0.66;
        const tau = (vf2) => portExtensionFromDelay(analyseCable(line(l, vf), { vf: vf2, length: 0 }).delay, vf2) / (C * vf2);
        expect(tau(0.8)).toBeCloseTo(tau(0.5), 11);
    });
});
