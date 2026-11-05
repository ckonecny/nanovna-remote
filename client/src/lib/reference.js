// Reference sweep of the HAM view: one stored SWR curve per band, drawn behind the live one.
import { resonance } from './resonance';

// what is kept of a sweep: frequency and SWR of every point, whether the app-side calibration was applied, and when
export function makeReference(points, calibrated, now = Date.now()) {
    return { at: now, calibrated: !!calibrated, show: true, points: points.map(p => ({ freq: p.freq, swr: p.swr })) };
}

// The live sweep belongs to the band: it covers it and is not much wider (right after a switch of band or view the old sweep,
// for example the full range, is still on display and must not be saved as the reference).
export function sweepFitsBand(points, band) {
    if (points.length < 2) return false;
    const first = points[0].freq, last = points[points.length - 1].freq;
    return first <= band.start && last >= band.stop && last - first <= 3 * (band.stop - band.start);
}

// a saved entry is only used when it has the expected shape
export function validReference(r) {
    return !!r && typeof r === 'object' && Array.isArray(r.points) && r.points.length > 1
        && r.points.every(p => Number.isFinite(p.freq) && typeof p.swr === 'number');
}

// minimum of a reference inside the band (see `resonance`; the limit is irrelevant for the minimum)
export const referenceMin = (ref, band) => {
    const inBand = ref.points.filter(p => p.freq >= band.start && p.freq <= band.stop);
    const r = resonance(ref.points, inBand, Infinity);
    return r ? r.min : null;
};

// live minus reference: change of the lowest SWR and of the frequency where it lies; null when one of them is missing
export function compareMinima(live, ref) {
    if (!live || !ref || !Number.isFinite(live.swr) || !Number.isFinite(ref.swr)) return null;
    return { swr: live.swr - ref.swr, freq: live.freq - ref.freq };
}

// when a reference was saved: the time, with the date in front unless it was saved today
export function savedAt(at, now = Date.now()) {
    const d = new Date(at);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date(now).toDateString() ? time : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
}
