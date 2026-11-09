// Battery state of the NanoVNA from its `vbat` reading (millivolts of the single Li-Ion cell).
// The device reports only the voltage: the percentage is a typical Li-Ion discharge curve, "charging" is a guess.

const CURVE = [[3300, 0], [3500, 5], [3600, 15], [3700, 40], [3800, 55], [3900, 70], [4000, 82], [4100, 93], [4200, 100]];

export function batteryPercent(mV) {
    if (!(mV > 0)) return null;
    if (mV <= CURVE[0][0]) return 0;
    for (let i = 1; i < CURVE.length; i++) {
        const [v1, p1] = CURVE[i];
        if (mV <= v1) {
            const [v0, p0] = CURVE[i - 1];
            return Math.round(p0 + ((p1 - p0) * (mV - v0)) / (v1 - v0));
        }
    }
    return 100;
}

// The charger holds the cell near 4.2 V, and while charging the voltage climbs: either counts as "charging".
// `history` holds the earlier readings (oldest first), `mV` the newest.
export function batteryCharging(mV, history) {
    if (mV >= 4150) return true;
    return history.length >= 2 && mV - Math.min(...history.slice(-4)) >= 15;
}
