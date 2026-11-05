// Resonance and usable bandwidth of an SWR sweep (HAM and Multi views).

export const SWR_LIMITS = [1.5, 2, 3];

// frequency where the SWR crosses `limit` between a point inside (a) and one outside (b); linear between the two points
const crossing = (a, b, limit) => {
    if (!Number.isFinite(b.swr)) return a.freq;
    const t = (limit - a.swr) / (b.swr - a.swr);
    return a.freq + t * (b.freq - a.freq);
};

// Lowest SWR among the points `inBand`, and the stretch around it where the SWR stays at or below `limit`, searched in all
// `points` (a sorted sweep). Edges are interpolated between neighbouring points. `lowOpen` / `highOpen` say that the stretch
// reaches the end of the sweep, so the true bandwidth may be wider. Returns null without points; `bandwidth` is null when
// even the minimum is above the limit.
export function resonance(points, inBand, limit) {
    if (!inBand.length) return null;
    const min = inBand.reduce((a, p) => (p.swr < a.swr ? p : a));
    if (!(min.swr <= limit)) return { min, bandwidth: null };
    const i0 = points.indexOf(min);
    let lo = i0, hi = i0;
    while (lo > 0 && points[lo - 1].swr <= limit) lo--;
    while (hi < points.length - 1 && points[hi + 1].swr <= limit) hi++;
    const lowOpen = lo === 0, highOpen = hi === points.length - 1;
    const from = lowOpen ? points[lo].freq : crossing(points[lo], points[lo - 1], limit);
    const to = highOpen ? points[hi].freq : crossing(points[hi], points[hi + 1], limit);
    return { min, bandwidth: { from, to, width: to - from, lowOpen, highOpen } };
}
