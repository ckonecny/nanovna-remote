import { describe, it, expect } from 'vitest';
import { computeTdr, strongestReflection, TDR_RANGES, describeRange } from '../lib/tdr';
import { C } from '../lib/cable';

// reflection coefficients of an ideal line of length l (m) ending in rho
const sweep = (l, rho, vf, range) => {
    const pts = [];
    for (let i = 0; i < 101; i++) {
        const f = range.start + (range.stop - range.start) * i / 100;
        const ph = -4 * Math.PI * f * l / (C * vf);
        pts.push({ freq: f, real: rho * Math.cos(ph), imag: rho * Math.sin(ph) });
    }
    return pts;
};

describe('tdr', () => {
    for (const [name, l] of [['short', 12.3], ['medium', 40], ['long', 150]]) {
        it(`finds an open end at ${l} m on the ${name} sweep`, () => {
            const tdr = computeTdr(sweep(l, 0.8, 0.66, TDR_RANGES[name]), 0.66);
            const r = strongestReflection(tdr, 0.5);
            expect(Math.abs(r.dist - l)).toBeLessThan(describeRange(TDR_RANGES[name], 0.66).resolution / 3);
            expect(r.value).toBeGreaterThan(0.6);
            expect(r.kind).toMatch(/open/);
        });
    }

    it('shows a short as a negative peak', () => {
        const tdr = computeTdr(sweep(12.3, -0.9, 0.66, TDR_RANGES.short), 0.66);
        const r = strongestReflection(tdr, 0.5);
        expect(r.value).toBeLessThan(-0.7);
        expect(r.kind).toMatch(/short/);
    });

    it('scales distance with the velocity factor', () => {
        const a = strongestReflection(computeTdr(sweep(12.3, 0.8, 0.66, TDR_RANGES.short), 0.66), 0.5).dist;
        const b = strongestReflection(computeTdr(sweep(12.3, 0.8, 0.66, TDR_RANGES.short), 0.83), 0.5).dist;
        expect(b / a).toBeCloseTo(0.83 / 0.66, 2);
    });
});

describe('tdr wrap-around', () => {
    it('puts a reflection just before 0 m (own delay of the device) at a negative distance', () => {
        const tdr = computeTdr(sweep(-0.3, 0.8, 0.66, TDR_RANGES.short), 0.66); // a negative length is a negative delay
        expect(tdr.dist[0]).toBeLessThan(0);
        const r = strongestReflection(tdr, -10);
        expect(Math.abs(r.dist + 0.3)).toBeLessThan(0.15);
        expect(Math.abs(strongestReflection(tdr, 2 * tdr.resolution).value)).toBeLessThan(0.15); // beyond the connector's lobe only sidelobes are left
    });
});
