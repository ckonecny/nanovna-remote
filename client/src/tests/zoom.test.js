import { describe, it, expect } from 'vitest';
import { transformRange, clampRange, pinchFactor } from '../lib/zoom';

describe('zoom', () => {
  it('zooms in around the anchor', () => {
    expect(transformRange(0, 100, 0.5, 2)).toEqual([25, 75]);
    expect(transformRange(0, 100, 0, 2)).toEqual([0, 50]);
    expect(transformRange(0, 100, 1, 4)).toEqual([75, 100]);
  });

  it('zooms out', () => {
    expect(transformRange(25, 75, 0.5, 0.5)).toEqual([0, 100]);
  });

  it('pans with the fingers', () => {
    // fingers move 10 % to the right: the view moves 10 % of its span to the left
    const [lo, hi] = transformRange(0, 100, 0.5, 1, 0.1);
    expect(lo).toBeCloseTo(-10);
    expect(hi).toBeCloseTo(90);
  });

  it('clamps', () => {
    expect(clampRange(-10, 90, 0, 100)).toEqual([0, 100]);
    expect(clampRange(-10, 40, 0, 100)).toEqual([0, 50]);
    expect(clampRange(70, 120, 0, 100)).toEqual([50, 100]);
    expect(clampRange(-50, 200, 0, 100)).toEqual([0, 100]);
  });

  it('ignores an axis with the fingers close together', () => {
    expect(pinchFactor(100, 200)).toBe(2);
    expect(pinchFactor(10, 200)).toBe(1);
  });
});
