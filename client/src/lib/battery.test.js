import { describe, it, expect } from 'vitest';
import { batteryPercent, batteryCharging } from './battery';

describe('battery', () => {
    it('maps voltage to percent along the curve', () => {
        expect(batteryPercent(4210)).toBe(100);
        expect(batteryPercent(4200)).toBe(100);
        expect(batteryPercent(3800)).toBe(55);
        expect(batteryPercent(3750)).toBe(48);
        expect(batteryPercent(3200)).toBe(0);
        expect(batteryPercent(0)).toBeNull();
    });
    it('guesses charging from a high or rising voltage', () => {
        expect(batteryCharging(4180, [])).toBe(true);
        expect(batteryCharging(3800, [3790, 3790, 3800])).toBe(false);
        expect(batteryCharging(3830, [3800, 3805, 3810])).toBe(true);
        expect(batteryCharging(3700, [3710, 3705])).toBe(false);
    });
});
