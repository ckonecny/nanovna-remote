import { describe, it, expect } from 'vitest';
import { parseVersion, isNewer, firmwareRepo, newerFirmware } from '../lib/fwcheck';
import { portExtend, C } from '../lib/cable';

const info = 'Board: NanoVNA-H\nVersion: 1.2.50 [p:101]';
const release = (tag) => async () => ({ ok: true, json: async () => ({ tag_name: tag, html_url: 'https://example.test/r' }) });

describe('firmware check', () => {
    it('compares dotted versions numerically', () => {
        expect(parseVersion('v1.2.50')).toEqual([1, 2, 50]);
        expect(parseVersion('1.2.x')).toBeNull();
        expect(isNewer('1.2.51', '1.2.50')).toBe(true);
        expect(isNewer('1.2.9', '1.2.50')).toBe(false);
        expect(isNewer('1.3', '1.2.50')).toBe(true);
        expect(isNewer('1.2.50', '1.2.50')).toBe(false);
    });
    it('knows the project of a board', () => {
        expect(firmwareRepo(info)).toBe('hugen79/NanoVNA-H');
        expect(firmwareRepo('Board: NanoVNA-H 4\n')).toBe('hugen79/NanoVNA-H4');
        expect(firmwareRepo('Board: NanoVNA-F\n')).toBeNull();
    });
    it('reports only a newer release', async () => {
        expect(await newerFirmware('1.2.50', info, release('1.2.51'))).toEqual({ tag: '1.2.51', url: 'https://example.test/r' });
        expect(await newerFirmware('1.2.50', info, release('1.2.50'))).toBeNull();
        expect(await newerFirmware('1.2.50', 'Board: Other', release('9.9.9'))).toBeNull();
        expect(await newerFirmware('1.2.50', info, async () => { throw new Error('offline'); })).toBeNull();
    });
});

describe('port extension', () => {
    it('turns a matched line back to a match and leaves 0 alone', () => {
        const tau = 5 / (C * 0.66);
        const f = 100e6, a = -4 * Math.PI * f * tau;
        const seen = [{ freq: f, real: 0.3 * Math.cos(a), imag: 0.3 * Math.sin(a) }];
        const [p] = portExtend(seen, tau);
        expect(p.real).toBeCloseTo(0.3, 9);
        expect(p.imag).toBeCloseTo(0, 9);
        expect(portExtend(seen, 0)).toBe(seen);
    });
});
