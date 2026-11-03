import { describe, it, expect } from 'vitest';
import * as dsp from '../lib/dsp';

describe('DSP utilities', () => {
    it('calcLogMag should return correct dB value', () => {
        const i = { real: 1, imag: 0 };
        expect(dsp.calcLogMag(i)).toBe(0);

        const i2 = { real: 0.1, imag: 0 };
        expect(dsp.calcLogMag(i2)).toBeCloseTo(-20);
    });

    it('calcSWR should return correct SWR value', () => {
        const i = { real: 0, imag: 0 }; // Matched load
        expect(dsp.calcSWR(i)).toBe(1);

        const i2 = { real: 0.5, imag: 0 }; // Reflection 0.5
        // SWR = (1 + 0.5) / (1 - 0.5) = 1.5 / 0.5 = 3
        expect(dsp.calcSWR(i2)).toBe(3);
    });

    it('calcPhase should return correct phase in degrees', () => {
        // Standard phase θ = atan2(imag, real)
        expect(dsp.calcPhase({ real: 1, imag: 0 })).toBeCloseTo(0);
        expect(dsp.calcPhase({ real: 0, imag: 1 })).toBeCloseTo(90);
        expect(dsp.calcPhase({ real: -1, imag: 0 })).toBeCloseTo(180);
        expect(dsp.calcPhase({ real: 0, imag: -1 })).toBeCloseTo(-90);
        expect(dsp.calcPhase({ real: 1, imag: 1 })).toBeCloseTo(45);
    });

    it('calcZ should return correct impedance', () => {
        const i = { real: 0, imag: 0 }; // 50 ohm load
        expect(dsp.calcZ(i)).toEqual([50, 0]);

        const i2 = { real: 1, imag: 0 }; // Open
        // d = 50 / (0^2 + 0^2) = Inf
        // zr = (2*0 - 0) * Inf...
        // Actually, Open in NanoVNA is slightly less than 1 or handled.
    });

    it('formatFrequency should format correctly', () => {
        expect(dsp.formatFrequency(100)).toBe('100 Hz');
        expect(dsp.formatFrequency(1000)).toBe('1.000 kHz');
        expect(dsp.formatFrequency(1000000)).toBe('1.000000 MHz');
    });

    it('formatLogMag should format with dB unit', () => {
        expect(dsp.formatLogMag(0)).toBe('0.00 dB');
        expect(dsp.formatLogMag(-20)).toBe('-20.00 dB');
        expect(dsp.formatLogMag(-20.123)).toBe('-20.12 dB');
        expect(dsp.formatLogMag(3.456)).toBe('3.46 dB');
    });

    it('formatPhase should format with degree symbol', () => {
        expect(dsp.formatPhase(0)).toBe('0.0°');
        expect(dsp.formatPhase(90)).toBe('90.0°');
        expect(dsp.formatPhase(-45.67)).toBe('-45.7°');
        expect(dsp.formatPhase(180.123)).toBe('180.1°');
    });

    it('formatSWR should handle infinity and format correctly', () => {
        expect(dsp.formatSWR(1)).toBe('1.00');
        expect(dsp.formatSWR(3)).toBe('3.00');
        expect(dsp.formatSWR(1.234)).toBe('1.23');
        expect(dsp.formatSWR(Infinity)).toBe('∞');
    });

    it('formatLinear should format to 4 decimal places', () => {
        expect(dsp.formatLinear(0.5)).toBe('0.5000');
        expect(dsp.formatLinear(0.12345)).toBe('0.1235');
        expect(dsp.formatLinear(1)).toBe('1.0000');
    });

    it('formatReal should format to 4 decimal places', () => {
        expect(dsp.formatReal(0.5)).toBe('0.5000');
        expect(dsp.formatReal(-0.12345)).toBe('-0.1235');
        expect(dsp.formatReal(1)).toBe('1.0000');
    });

    it('formatImag should format to 4 decimal places', () => {
        expect(dsp.formatImag(0.5)).toBe('0.5000');
        expect(dsp.formatImag(-0.12345)).toBe('-0.1235');
        expect(dsp.formatImag(1)).toBe('1.0000');
    });
});

describe('more trace formats', () => {
    // Γ of Z = 50 + j50: (z - 50) / (z + 50)
    const g = { freq: 1e6, real: 0.2, imag: 0.4 };

    it('series and parallel values, Q', () => {
        const [r, x] = dsp.calcZ(g);
        expect(r).toBeCloseTo(50);
        expect(x).toBeCloseTo(50);
        expect(dsp.calcQ(g)).toBeCloseTo(1);
        expect(dsp.calcRp(g)).toBeCloseTo(100);
        expect(dsp.calcXp(g)).toBeCloseTo(100);
    });

    it('admittance Smith mirrors Γ: y = 1 / z', () => {
        const z = dsp.calcZr(g);
        const y = dsp.calcYr(g);
        const d = z.real ** 2 + z.imag ** 2;
        expect(y.real).toBeCloseTo(z.real / d);
        expect(y.imag).toBeCloseTo(-z.imag / d);
    });

    it('group delay of a pure delay is constant, also across phase wraps', () => {
        const tau = 5e-9;
        const pts = [];
        for (let k = 0; k < 40; k++) {
            const freq = 100e6 + k * 20e6;
            const a = -2 * Math.PI * freq * tau;
            pts.push({ freq, real: Math.cos(a), imag: Math.sin(a) });
        }
        const gd = dsp.calcGroupDelay(pts);
        gd.forEach(v => expect(v).toBeCloseTo(5, 3));
        expect(dsp.traceValues(pts, 'gd')).toEqual(gd);
    });

    it('traceValues gives one value per point; formatting', () => {
        expect(dsp.traceValues([g, g], 'Q').length).toBe(2);
        expect(dsp.formatTraceValue('gd', 5)).toBe('5.00 ns');
        expect(dsp.formatTraceValue('R', 50)).toBe('50.000 Ω');
        expect(dsp.formatTraceValue('Q', 120)).toBe('120.0');
    });
});
