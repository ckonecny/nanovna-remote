import { describe, it, expect } from 'vitest';
import { rlFromSwr, formatZ, matchValue } from '../lib/valuefmt';

describe('value formats', () => {
    it('return loss from SWR', () => {
        expect(rlFromSwr(3)).toBeCloseTo(6.02, 2);
        expect(rlFromSwr(1)).toBe(Infinity);
        expect(rlFromSwr(Infinity)).toBe(0);
    });
    it('impedance as R + jX or |Z| and angle', () => {
        expect(formatZ(50, 0)).toBe('50.0 + j0.0 Ω');
        expect(formatZ(30, -40)).toBe('30.0 − j40.0 Ω');
        expect(formatZ(30, 40, 'polar')).toBe('50.0 Ω ∠ 53.1°');
        expect(formatZ(30, -40, 'polar')).toBe('50.0 Ω ∠ -53.1°');
    });
    it('match as SWR or return loss', () => {
        expect(matchValue(1.5)).toEqual({ label: 'SWR', text: '1.50' });
        expect(matchValue(3, 'rl')).toEqual({ label: 'RL', text: '6.0 dB' });
        expect(matchValue(1, 'rl').text).toBe('∞');
    });
});
