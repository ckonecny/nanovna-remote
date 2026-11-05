// How impedance and match values are shown (the user's choice, store.zFormat and store.matchMain):
// impedance as R + jX or as |Z| with its angle; the match as SWR or as return loss.
export const Z_FORMATS = ['rx', 'polar'];
export const MATCH_MAINS = ['swr', 'rl'];

const MINUS = '−';

// return loss in dB from an SWR (0 dB for an infinite SWR, infinite for a perfect match)
export function rlFromSwr(swr) {
    if (!Number.isFinite(swr)) return 0;
    if (swr <= 1) return Infinity;
    return -20 * Math.log10((swr - 1) / (swr + 1));
}

// impedance r + jx (ohm) as text: "47.1 + j12.0 Ω" or "48.6 Ω ∠ 14.3°"
export function formatZ(r, x, mode = 'rx', digits = 1) {
    if (mode === 'polar') {
        const deg = Math.atan2(x, r) * 180 / Math.PI;
        return `${Math.hypot(r, x).toFixed(digits)} Ω ∠ ${deg.toFixed(1)}°`;
    }
    return `${r.toFixed(digits)} ${x < 0 ? MINUS : '+'} j${Math.abs(x).toFixed(digits)} Ω`;
}

// the match as the main value: label and text ("SWR", "1.35" or "RL", "16.5 dB")
export function matchValue(swr, main = 'swr') {
    if (main === 'rl') {
        const rl = rlFromSwr(swr);
        return { label: 'RL', text: Number.isFinite(rl) ? rl.toFixed(1) + ' dB' : '∞' };
    }
    return { label: 'SWR', text: Number.isFinite(swr) ? swr.toFixed(2) : '∞' };
}
