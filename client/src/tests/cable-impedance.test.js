import { describe, expect, it } from 'vitest';
import { C, analyseImpedance, stubLength, wavelength } from '../lib/cable';

// reflection of a line (z0, loss in Np/m, vf, length) terminated with an open or a short, seen from 50 ohm
function sweep(z0, alpha, vf, length, end, f0 = 1e6, f1 = 30e6, n = 101) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const f = f0 + (f1 - f0) * i / (n - 1), beta = 2 * Math.PI * f / (C * vf), x = alpha * length, y = beta * length;
        // tanh(x + jy) = (sinh 2x + j sin 2y) / (cosh 2x + cos 2y)
        const d = Math.cosh(2 * x) + Math.cos(2 * y), th = { re: Math.sinh(2 * x) / d, im: Math.sin(2 * y) / d };
        const m = th.re * th.re + th.im * th.im;
        const z = end === 'short' ? { re: z0 * th.re, im: z0 * th.im } : { re: z0 * th.re / m, im: -z0 * th.im / m };
        const dd = (z.re + 50) ** 2 + z.im ** 2;
        pts.push({ freq: f, real: ((z.re ** 2 + z.im ** 2) - 2500) / dd, imag: 100 * z.im / dd });
    }
    return pts;
}

describe('characteristic impedance', () => {
    it('finds 50 ohm and 75 ohm lines', () => {
        for (const z0 of [50, 75]) {
            const r = analyseImpedance(sweep(z0, 0.01, 0.66, 12, 'open'), sweep(z0, 0.01, 0.66, 12, 'short'));
            expect(r.z0).toBeCloseTo(z0, 0);
            expect(r.n).toBeGreaterThan(20);
        }
    });
    it('finds it for a lossy line', () => {
        const r = analyseImpedance(sweep(50, 0.05, 0.66, 20, 'open'), sweep(50, 0.05, 0.66, 20, 'short'));
        expect(r.z0).toBeCloseTo(50, 0);
    });
    it('gives up for a very short cable', () => {
        expect(analyseImpedance(sweep(50, 0.01, 0.66, 0.05, 'open'), sweep(50, 0.01, 0.66, 0.05, 'short'))).toBeNull();
    });
    it('rejects mismatching sweeps', () => {
        expect(analyseImpedance(sweep(50, 0, 0.66, 5, 'open'), sweep(50, 0, 0.66, 5, 'short', 1e6, 30e6, 51))).toBeNull();
    });
});

describe('stub lengths', () => {
    const base = { freq: 14.2e6, vf: 0.66, z0: 50 };
    it('shorted stub of a quarter wave is an open circuit', () => {
        const q = wavelength(base.freq, base.vf) / 4;
        expect(stubLength({ ...base, x: 1e9, type: 'short' })).toBeCloseTo(q, 2);
    });
    it('open stub of a quarter wave is a short circuit', () => {
        const q = wavelength(base.freq, base.vf) / 4;
        expect(stubLength({ ...base, x: 1e-9, type: 'open' })).toBeCloseTo(q, 2);
    });
    it('gives the reactance back', () => {
        for (const x of [-120, -30, 40, 200]) {
            for (const type of ['short', 'open']) {
                const l = stubLength({ ...base, x, type }), bl = 2 * Math.PI * base.freq * l / (C * base.vf);
                const got = type === 'short' ? 50 * Math.tan(bl) : -50 / Math.tan(bl);
                expect(got).toBeCloseTo(x, 3);
                expect(l).toBeLessThan(wavelength(base.freq, base.vf) / 2);
            }
        }
    });
});
