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
