import { describe, expect, it } from 'vitest';
import { bandFileName, touchstone } from '../lib/export';

describe('export', () => {
    const now = new Date(2026, 10, 2, 9, 5, 7);
    it('names files after band and date', () => {
        expect(bandFileName('20 m', 's1p', { now })).toBe('20m-20261102.s1p');
        expect(bandFileName('70 cm', 'png', { now, withTime: true })).toBe('70cm-20261102-090507.png');
    });
    it('writes Touchstone with the same layout as the side menu', () => {
        expect(touchstone([{ freq: 7e6, real: 0.1, imag: -0.2 }, { freq: 7.1e6, real: 0, imag: 0.5 }]))
            .toBe('# Hz S RI R 50\n7000000\t0.1\t-0.2\n7100000\t0\t0.5\n');
    });
});
