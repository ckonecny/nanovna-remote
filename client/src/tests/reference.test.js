import { describe, it, expect } from 'vitest';
import { makeReference, validReference, referenceMin, compareMinima, sweepFitsBand, savedAt } from '../lib/reference';

const pts = (swrs) => swrs.map((swr, i) => ({ freq: 100 + i * 10, swr, real: 0, imag: 0 }));

describe('reference', () => {
    it('keeps only frequency and SWR, and the calibration flag', () => {
        const r = makeReference(pts([2, 1.5]), true, 5);
        expect(r).toEqual({ at: 5, calibrated: true, show: true, points: [{ freq: 100, swr: 2 }, { freq: 110, swr: 1.5 }] });
    });
    it('validates saved entries', () => {
        expect(validReference(makeReference(pts([2, 1.5]), false))).toBe(true);
        expect(validReference(null)).toBe(false);
        expect(validReference({ points: [{ freq: 1, swr: 2 }] })).toBe(false);
        expect(validReference({ points: [{ freq: 1, swr: 2 }, { freq: 2, swr: 'x' }] })).toBe(false);
    });
    it('finds the minimum inside the band only', () => {
        const r = makeReference(pts([1.1, 3, 1.4, 2]), false); // 100..130
        expect(referenceMin(r, { start: 110, stop: 130 }).freq).toBe(120);
        expect(referenceMin(r, { start: 500, stop: 600 })).toBeNull();
    });
    it('compares minima as live minus reference', () => {
        expect(compareMinima({ swr: 1.2, freq: 135 }, { swr: 1.6, freq: 100 })).toEqual({ swr: expect.closeTo(-0.4, 9), freq: 35 });
        expect(compareMinima(null, { swr: 1, freq: 1 })).toBeNull();
        expect(compareMinima({ swr: Infinity, freq: 1 }, { swr: 1, freq: 1 })).toBeNull();
    });
    it('accepts only a sweep that belongs to the band', () => {
        const band = { start: 14000, stop: 14350 };
        const sweep = (a, b, n = 11) => Array.from({ length: n }, (_, i) => ({ freq: a + (b - a) * i / (n - 1), swr: 1 }));
        expect(sweepFitsBand(sweep(13950, 14400), band)).toBe(true);
        expect(sweepFitsBand(sweep(50, 900000), band)).toBe(false); // full range still on display
        expect(sweepFitsBand(sweep(14100, 14400), band)).toBe(false); // does not cover the band
        expect(sweepFitsBand([], band)).toBe(false);
    });
    it('shows the date of a reference that was not saved today', () => {
        const now = new Date(2026, 10, 6, 9, 0).getTime();
        const today = savedAt(new Date(2026, 10, 6, 8, 5).getTime(), now);
        const earlier = savedAt(new Date(2026, 10, 5, 16, 57).getTime(), now);
        expect(today).toMatch(/^\d{1,2}[:.]\d{2}/); // time only
        expect(earlier.length).toBeGreaterThan(today.length);
        expect(earlier).toContain(',');
        expect(earlier).toMatch(/5/);
    });
});
