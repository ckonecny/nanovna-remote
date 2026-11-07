import { describe, it, expect } from 'vitest';
import { resonance } from '../lib/resonance';

const pts = (swrs, f0 = 100, step = 10) => swrs.map((swr, i) => ({ freq: f0 + i * step, swr }));

describe('resonance', () => {
    it('finds the minimum and interpolates the edges at the limit', () => {
        const p = pts([4, 3, 1.5, 1.2, 1.5, 3]); // 100..150
        const r = resonance(p, p, 2);
        expect(r.min.freq).toBe(130);
        // 3 (110) -> 1.5 (120) crosses 2 a third of the step below 120; 1.5 (140) -> 3 (150) a third above 140
        expect(r.bandwidth.from).toBeCloseTo(120 - 10 / 3, 6);
        expect(r.bandwidth.to).toBeCloseTo(140 + 10 / 3, 6);
        expect(r.bandwidth.lowOpen).toBe(false);
        expect(r.bandwidth.highOpen).toBe(false);
    });
    it('no bandwidth when the minimum is above the limit', () => {
        const p = pts([4, 3, 2.5, 3]);
        expect(resonance(p, p, 2).bandwidth).toBeNull();
    });
    it('uses only the dip around the minimum, not a separate wider one', () => {
        const p = pts([1.9, 1.9, 1.9, 5, 5, 1.2, 1.8, 5]);
        const r = resonance(p, p, 2);
        expect(r.min.freq).toBe(150);
        expect(r.bandwidth.from).toBeLessThan(150);
        expect(r.bandwidth.from).toBeGreaterThan(140);
    });
    it('marks a stretch that runs to the end of the sweep as open', () => {
        const p = pts([1.2, 1.4, 1.8, 3]);
        const r = resonance(p, p, 2);
        expect(r.bandwidth.lowOpen).toBe(true);
        expect(r.bandwidth.highOpen).toBe(false);
        expect(r.bandwidth.from).toBe(100);
    });
    it('handles an infinite neighbour', () => {
        const p = pts([Infinity, 1.5, Infinity]);
        const r = resonance(p, p, 2);
        expect(r.bandwidth.from).toBe(110);
        expect(r.bandwidth.to).toBe(110);
    });
    it('returns null without points in the band', () => {
        expect(resonance(pts([1.5]), [], 2)).toBeNull();
    });
});

import { reactanceZero, lengthHint } from '../lib/resonance';

const zp = (xs, f0 = 100, step = 10) => xs.map((xr, i) => ({ freq: f0 + i * step, xr, r: 40 + i, swr: 1 + i / 10 }));

describe('reactanceZero', () => {
    it('interpolates the rising crossing and the values there', () => {
        const z = reactanceZero(zp([-30, -10, 10, 30]));
        expect(z.freq).toBeCloseTo(115, 6); // halfway between 110 (-10) and 120 (+10)
        expect(z.r).toBeCloseTo(41.5, 6);
        expect(z.swr).toBeCloseTo(1.15, 6);
    });
    it('ignores a falling crossing (parallel resonance)', () => {
        expect(reactanceZero(zp([30, 10, -10, -30]))).toBeNull();
    });
    it('is null without a crossing', () => {
        expect(reactanceZero(zp([10, 20, 30]))).toBeNull();
        expect(reactanceZero([])).toBeNull();
    });
    it('takes the crossing closest to the given frequency', () => {
        const p = zp([-10, 10, -10, 10, -10, 10]); // rising at 105, 125, 145
        expect(reactanceZero(p, 130).freq).toBeCloseTo(125, 6);
        expect(reactanceZero(p, 100).freq).toBeCloseTo(105, 6);
    });
});

describe('lengthHint', () => {
    it('resonance below the target: too long', () => {
        const h = lengthHint(7.0, 7.1);
        expect(h.dir).toBe('long');
        expect(h.pct).toBeCloseTo((7.1 / 7.0 - 1) * 100, 6);
    });
    it('resonance above the target: too short', () => {
        const h = lengthHint(14.4, 14.175);
        expect(h.dir).toBe('short');
        expect(h.pct).toBeCloseTo((1 - 14.175 / 14.4) * 100, 6);
    });
    it('nothing to say within 0.2 %', () => {
        expect(lengthHint(7.1, 7.105)).toBeNull();
        expect(lengthHint(0, 7.1)).toBeNull();
    });
});
