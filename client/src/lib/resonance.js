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

// Series resonance: the frequency where the reactance X crosses 0 Ω going up (capacitive below, inductive above), found between
// neighbouring points of `inBand` by linear interpolation. R and SWR at that frequency are interpolated the same way. A falling
// crossing is a parallel resonance (high R) and is not an antenna's series resonance, so it is ignored. With several rising
// crossings the one closest to `near` (a frequency, usually the SWR minimum) is returned. Points need `freq`, `xr`, `r`, `swr`.
// Returns null when X does not cross zero inside the band.
export function reactanceZero(inBand, near = null) {
    let best = null;
    for (let i = 1; i < inBand.length; i++) {
        const a = inBand[i - 1], b = inBand[i];
        if (!(a.xr < 0 && b.xr >= 0) || !isFinite(a.xr) || !isFinite(b.xr)) continue;
        const t = b.xr === a.xr ? 0 : (0 - a.xr) / (b.xr - a.xr);
        const hit = { freq: a.freq + t * (b.freq - a.freq), r: a.r + t * (b.r - a.r), swr: a.swr + t * (b.swr - a.swr) };
        if (!best || (near !== null && Math.abs(hit.freq - near) < Math.abs(best.freq - near))) best = hit;
    }
    return best;
}

// Rule of thumb for a simple resonant antenna: the resonance moves inversely with the length, so a resonance below the target means
// the antenna is too long by about (target / f - 1), above it too short. `target` is the band centre. Returns null when the
// resonance is within 0.2 % of the target (nothing to do); otherwise { dir: 'long' | 'short', pct } with pct > 0.
export function lengthHint(freq, target) {
    if (!(freq > 0) || !(target > 0)) return null;
    const pct = Math.abs(target / freq - 1) * 100;
    if (pct < 0.2) return null;
    return { dir: freq < target ? 'long' : 'short', pct };
}
