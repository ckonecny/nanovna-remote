import { describe, it, expect } from 'vitest';
import { readout, delta, search, nearestIndex, eng } from '../lib/marker';

// reflection coefficient of Z (50 ohm reference)
const gamma = (zr, zi, freq) => {
    const nr = zr - 50, dr = zr + 50, d = dr * dr + zi * zi;
    return { freq, real: (nr * dr + zi * zi) / d, imag: (zi * dr - nr * zi) / d };
};

describe('marker readout', () => {
    it('matched load', () => {
        const r = readout(gamma(50, 0, 1e6));
        expect(r.swr).toBeCloseTo(1, 6);
        expect(r.r).toBeCloseTo(50, 6);
        expect(r.q).toBeCloseTo(0, 6);
    });
    it('series R + L: inductance, Q and parallel circuit', () => {
        const f = 10e6, l = 1e-6, r0 = 20;
        const x = 2 * Math.PI * f * l;
        const r = readout(gamma(r0, x, f));
        expect(r.ls).toBeCloseTo(l, 12);
        expect(r.cs).toBeNull();
        expect(r.q).toBeCloseTo(x / r0, 6);
        // Rp = R (1 + Q^2), Lp = L (1 + 1/Q^2)
        const q = x / r0;
        expect(r.rp).toBeCloseTo(r0 * (1 + q * q), 4);
        expect(r.lp).toBeCloseTo(l * (1 + 1 / (q * q)), 12);
    });
    it('capacitive: series capacitance', () => {
        const f = 5e6, c = 100e-12;
        const x = -1 / (2 * Math.PI * f * c);
        const r = readout(gamma(30, x, f));
        expect(r.cs).toBeCloseTo(c, 15);
        expect(r.ls).toBeNull();
        expect(r.cp).toBeGreaterThan(0);
    });
    it('delta and search', () => {
        const pts = [[1, 60], [2, 70], [3, 50], [4, 90]].map(([i, z]) => gamma(z, 0, i * 1e6));
        const a = readout(pts[0]), b = readout(pts[3]);
        expect(delta(a, b).freq).toBe(3e6);
        expect(search(pts, (p) => Math.hypot(p.real, p.imag), 'min')).toBe(3e6);
        expect(search(pts, (p) => Math.hypot(p.real, p.imag), 'max')).toBe(4e6);
        expect(nearestIndex(pts, 2.4e6)).toBe(1);
        expect(delta({ swr: Infinity, freq: 1 }, { swr: 2, freq: 2 }).swr).toBeNull();
    });
    it('engineering notation', () => {
        expect(eng(4.7e-9, 'H')).toBe('4.70 nH');
        expect(eng(1.2e-11, 'F')).toBe('12.0 pF');
        expect(eng(Infinity, 'Ω')).toBe('∞ Ω');
    });
});
