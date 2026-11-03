import { describe, it, expect } from 'vitest';
import { solveOSL, correctPoint, applyCal, checkStandard } from '../lib/oslcal';

// simulate a one-port with known error terms and check that the calibration undoes them
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] ** 2 + b[1] ** 2; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const measure = (g, ed, es, er) => {
    const num = cmul(er, g);
    const den = [1 - (es[0] * g[0] - es[1] * g[1]), -(es[0] * g[1] + es[1] * g[0])];
    const q = cdiv(num, den);
    return [ed[0] + q[0], ed[1] + q[1]];
};

describe('oslcal', () => {
    const ed = [0.05, -0.02], es = [0.1, 0.03], er = [0.9, 0.2];

    it('recovers an unknown reflection coefficient', () => {
        const o = [measure([1, 0], ed, es, er)], s = [measure([-1, 0], ed, es, er)], l = [measure([0, 0], ed, es, er)];
        const t = solveOSL(o, s, l);
        const g = [0.3, -0.4];
        const c = correctPoint(measure(g, ed, es, er), t.ed[0], t.es[0], t.er[0]);
        expect(c[0]).toBeCloseTo(g[0], 9);
        expect(c[1]).toBeCloseTo(g[1], 9);
    });

    it('leaves points outside every calibrated range alone', () => {
        const cal = { freqs: [1e6, 2e6], ed: [[0, 0], [0, 0]], es: [[0, 0], [0, 0]], er: [[1, 0], [1, 0]] };
        const { points, covered } = applyCal([{ freq: 5e6, real: 0.5, imag: 0 }], { a: cal });
        expect(covered).toBe(0);
        expect(points[0].real).toBe(0.5);
    });
});

describe('checkStandard', () => {
    const ed = [0.05, -0.02], es = [0.1, 0.03], er = [0.9, 0.2];
    const std = (g) => ({ b: [0, 1, 2].map((i) => measure([g[0], g[1] + i * 0.01], ed, es, er)) });
    const open = std([1, 0]), short = std([-1, 0]), load = std([0, 0]);

    it('accepts the right standards in the right order', () => {
        expect(checkStandard('open', open)).toBeNull();
        expect(checkStandard('open', open, { open: {}, short: {} })).toBeNull(); // as the app passes "nothing measured yet"
        expect(checkStandard('short', short, { open })).toBeNull();
        expect(checkStandard('load', load, { open, short })).toBeNull();
    });

    it('notices a load where an open or short is asked for', () => {
        expect(checkStandard('open', load)).toMatch(/load/);
        expect(checkStandard('short', load, { open })).toMatch(/load/);
    });

    it('notices the same standard measured twice', () => {
        expect(checkStandard('short', open, { open })).toMatch(/same as the open/);
        expect(checkStandard('open', short, { short })).toMatch(/same as the short/);
    });

    it('notices an open or short where the load is asked for', () => {
        expect(checkStandard('load', open, { open, short })).toMatch(/absorb/);
        expect(checkStandard('load', short, { open, short })).toMatch(/absorb/);
    });
});
