import { appCal } from './oslcal';

// Calibration state of a set of bands: 'ok' (all calibrated), 'part' (some) or 'none'; `text` says it in words.
export function calState(bands) {
    const done = bands.filter(n => appCal.enabled && appCal.bands[n]).length;
    const state = !bands.length ? 'none' : done === bands.length ? 'ok' : done ? 'part' : 'none';
    let text;
    if (state === 'ok') text = bands.length > 1 ? `Calibrated (${done} of ${bands.length} bands)` : 'Calibrated';
    else if (state === 'part') text = `Partly calibrated: ${done} of ${bands.length} bands`;
    else text = 'NOT calibrated: values are uncorrected';
    return { state, done, text };
}
