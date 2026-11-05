import { describe, it, expect } from 'vitest';
import { thin, downsample, inWindow, niceScale, clockLabel, durationText, toCsv, pack, unpack, derive, plotValue, LOG_FORMATS, LOG_MAX } from '../lib/tracelog';

// raw readings: a reflection of magnitude 0.1 * (1 + i % 7) at a changing angle
const series = (n, step = 1000) => Array.from({ length: n }, (_, i) => ({ t: 1000000 + i * step, f: 145e6, re: 0.1 * (1 + (i % 7)) * Math.cos(i / 10), im: 0.1 * (1 + (i % 7)) * Math.sin(i / 10) }));
const swr = (p) => LOG_FORMATS.swr.series[0].get(p);

describe('single-frequency log', () => {
    it('thinning halves the log, keeps the newest point and doubles the interval', () => {
        const pts = series(101);
        const r = thin(pts, 1000);
        expect(r.points.length).toBe(51);
        expect(r.points[r.points.length - 1]).toBe(pts[100]);
        expect(r.intervalMs).toBe(2000);
    });
    it('thinning gives "every reading" a real interval from the spacing', () => {
        const r = thin(series(11, 900), 0);
        expect(r.intervalMs).toBe(1800);
    });
    it('the log limit is a sensible size', () => {
        expect(LOG_MAX).toBeGreaterThan(1000);
    });
    it('downsampling keeps the lowest and highest value of a bucket', () => {
        const pts = series(1000);
        pts[500].re = 0.99; pts[500].im = 0; // a spike up
        pts[501].re = 0; pts[501].im = 0; // and a perfect match
        const out = downsample(pts, swr, 50);
        expect(out.length).toBeLessThanOrEqual(100);
        expect(out).toContain(pts[500]);
        expect(out).toContain(pts[501]);
        expect(out.every((p, i) => i === 0 || p.t >= out[i - 1].t)).toBe(true);
    });
    it('downsampling leaves a short series alone', () => {
        const pts = series(20);
        expect(downsample(pts, swr, 50)).toBe(pts);
    });
    it('window: the last seconds of the log', () => {
        const pts = series(100); // one per second
        expect(inWindow(pts, 0)).toBe(pts);
        expect(inWindow(pts, 10).length).toBe(11);
        expect(inWindow([], 10)).toEqual([]);
    });
    it('rounded axis', () => {
        const s = niceScale(1.03, 2.4);
        expect(s.lo).toBeLessThanOrEqual(1.03);
        expect(s.hi).toBeGreaterThanOrEqual(2.4);
        expect(s.ticks.length).toBeGreaterThanOrEqual(3);
        const flat = niceScale(2, 2);
        expect(flat.hi).toBeGreaterThan(flat.lo);
        expect(niceScale(0, 100).ticks).toEqual([0, 25, 50, 75, 100]);
        expect(niceScale(0, 100).decimals).toBe(0);
    });
    it('a nearly constant value gets a calm axis with distinct labels', () => {
        const s = niceScale(24.49, 24.51, 4, 2);
        expect(s.hi - s.lo).toBeGreaterThanOrEqual(2);
        expect(s.lo).toBeLessThan(24.49);
        expect(s.hi).toBeGreaterThan(24.51);
        const labels = s.ticks.map(t => t.toFixed(s.decimals));
        expect(new Set(labels).size).toBe(labels.length);
        expect(niceScale(1, 1.3).decimals).toBe(1);
    });
    it('clock labels and durations', () => {
        const t = new Date(2026, 10, 5, 9, 4, 7).getTime();
        expect(clockLabel(t, 60000)).toBe('09:04:07');
        expect(clockLabel(t, 3600000)).toBe('09:04');
        expect(clockLabel(t, 2 * 86400000)).toBe('05.11 09:04');
        expect(durationText(45000)).toBe('45 s');
        expect(durationText(200000)).toBe('3 min 20 s');
        expect(durationText(3900000)).toBe('1 h 05 min');
    });
    it('derives the formats from the raw reflection', () => {
        const d = derive({ t: 0, f: 145e6, re: 0, im: 0 }); // a perfect 50 Ω load
        expect(d.swr).toBeCloseTo(1, 6);
        expect(d.r).toBeCloseTo(50, 6);
        expect(d.x).toBeCloseTo(0, 6);
        expect(d.z).toBeCloseTo(50, 6);
        const o = derive({ t: 0, f: 145e6, re: 1 / 3, im: 0 }); // 100 Ω
        expect(o.swr).toBeCloseTo(2, 6);
        expect(o.rl).toBeCloseTo(9.54, 2);
        expect(o.r).toBeCloseTo(100, 6);
        expect(o.rp).toBeCloseTo(100, 6);
        const c = derive({ t: 0, f: 145e6, re: 0, im: -0.5 });
        expect(c.x).toBeLessThan(0);
        expect(c.q).toBeGreaterThan(0);
    });
    it('plotted values are limited to what the format draws', () => {
        const open = { t: 0, f: 1, re: 1, im: 0 }; // SWR infinite
        expect(plotValue('swr', LOG_FORMATS.swr.series[0], open)).toBe(10);
        const good = { t: 0, f: 1, re: 0, im: 0 };
        expect(plotValue('swr', LOG_FORMATS.swr.series[0], good)).toBeGreaterThanOrEqual(1);
        expect(plotValue('rl', LOG_FORMATS.rl.series[0], good)).toBe(60); // return loss of a perfect match is infinite
        expect(plotValue('phase', LOG_FORMATS.phase.series[0], { t: 0, f: 1, re: 0, im: 1 })).toBeCloseTo(90, 6);
    });
    it('every format has at least one series with a label and a narrowest range', () => {
        for (const f of Object.values(LOG_FORMATS)) {
            expect(f.series.length).toBeGreaterThan(0);
            expect(f.label).toBeTruthy();
            expect(f.span).toBeGreaterThan(0);
        }
    });
    it('CSV has a header, the raw reflection and every format', () => {
        const csv = toCsv([{ t: 0, f: 145e6, re: 0, im: 0 }, { t: 2500, f: 145e6, re: 1, im: 0 }]).split('\n');
        expect(csv[0]).toBe('time,elapsed_s,freq_hz,gamma_re,gamma_im,swr,return_loss_db,r_ohm,x_ohm,z_ohm,rp_ohm,xp_ohm,q,gamma_mag,phase_deg');
        const a = csv[1].split(',');
        expect(a[0]).toBe('1970-01-01T00:00:00.000Z');
        expect(a[1]).toBe('0.000');
        expect(a[2]).toBe('145000000');
        expect(a[5]).toBe('1.0000'); // SWR
        const b = csv[2].split(',');
        expect(b[1]).toBe('2.500');
        expect(b[5]).toBe(''); // SWR of an open end is not finite: an empty cell
        expect(csv.length).toBe(4); // header, two rows, final newline
    });
    it('pack and unpack are inverse; broken input gives an empty log', () => {
        const pts = series(5);
        expect(unpack(pack(pts))).toEqual(pts);
        expect(unpack(null)).toEqual([]);
        expect(unpack({ t: [1, 2], f: [1], re: [1], im: [1] })).toEqual([]);
        expect(unpack({ t: [1], f: [1], swr: [1], rl: [1], r: [1], x: [1] })).toEqual([]); // the format of the first build is dropped
    });
});
