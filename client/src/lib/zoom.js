// Two-finger zoom and pan of a chart axis.
// The value under `anchor` (0..1 across the axis, in the direction of increasing values) stays where the fingers are;
// `factor` > 1 zooms in, `shift` is how far the finger centre moved (as a fraction of the axis, increasing direction).
export function transformRange(lo, hi, anchor, factor, shift = 0) {
  const span = hi - lo;
  const next = span / factor;
  const at = lo + anchor * span;
  const start = at - (anchor + shift) * next;
  return [start, start + next];
}

// keep a range inside [min, max] without changing its span (unless it is wider than the limits)
export function clampRange(lo, hi, min, max) {
  const span = hi - lo;
  if (span >= max - min) return [min, max];
  if (lo < min) return [min, min + span];
  if (hi > max) return [max - span, max];
  return [lo, hi];
}

// pinch factor along one axis; a pinch that is nearly perpendicular to the axis does not zoom it
export function pinchFactor(d0, d1, minDistance = 24) {
  if (d0 < minDistance || d1 < minDistance) return 1;
  return d1 / d0;
}
