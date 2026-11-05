import { describe, it, expect } from 'vitest';
import { DEFAULT_ORDER, normalizeOrder, moveTo } from '../lib/order';

describe('section order', () => {
    it('uses the default without a saved order', () => {
        expect(normalizeOrder('ham', undefined)).toEqual(DEFAULT_ORDER.ham);
        expect(normalizeOrder('ham', 'x')).toEqual(DEFAULT_ORDER.ham);
    });
    it('keeps a saved order, drops unknown and repeated ids, appends new sections', () => {
        const d = DEFAULT_ORDER.multi;
        expect(normalizeOrder('multi', [d[2], 'gone', d[2], d[0]])).toEqual([d[2], d[0], d[1], d[3]]);
    });
    it('moves a section and clamps the position', () => {
        expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
        expect(moveTo(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
        expect(moveTo(['a', 'b', 'c'], 'b', -3)).toEqual(['b', 'a', 'c']);
        expect(moveTo(['a', 'b'], 'zz', 0)).toEqual(['a', 'b']);
    });
});
