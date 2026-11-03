/*
Math functions for NanoVNA data processing.
*/

export function calcLogMag(i) {
    return Math.log10(Math.hypot(i.real, i.imag)) * 20;
}

export function calcSWR(i) {
    const x = Math.hypot(i.real, i.imag);
    if (x >= 1) return Infinity;
    return (1 + x) / (1 - x);
}

export function calcPhase(i) {
    return Math.atan2(i.imag, i.real) / Math.PI * 180;
}

export function calcZ(i) {
    const z0 = 50;
    const d = z0 / ((1 - i.real) * (1 - i.real) + i.imag * i.imag);
    const zr = ((1 + i.real) * (1 - i.real) - i.imag * i.imag) * d;
    const zi = 2 * i.imag * d;
    return [zr, zi];
}

export function calcLinear(i) {
    return Math.hypot(i.real, i.imag);
}

export function calcReal(i) {
    return i.real;
}

export function calcImag(i) {
    return i.imag;
}

export function calcZabs(i) {
    return Math.hypot(...calcZ(i));
}

export function calcZR(i) {
    return calcZ(i)[0];
}

export function calcZX(i) {
    return calcZ(i)[1];
}

export function calcZr(i) {
    const d = ((1 - i.real) * (1 - i.real) + i.imag * i.imag);
    const zr = ((1 + i.real) * (1 - i.real) - i.imag * i.imag) / d;
    const zi = 2 * i.imag / d;
    return {
        freq: i.freq,
        real: zr,
        imag: zi
    };
}

// admittance Smith chart: the mirrored reflection coefficient read on the impedance grid is y = 1 / z
export function calcYr(i) {
    return calcZr({ freq: i.freq, real: -i.real, imag: -i.imag });
}

// series reactance X, parallel resistance Rp = (R² + X²) / R and parallel reactance Xp = (R² + X²) / X
export function calcQ(i) {
    const [r, x] = calcZ(i);
    return Math.abs(x) / r;
}

export function calcRp(i) {
    const [r, x] = calcZ(i);
    return (r * r + x * x) / r;
}

export function calcXp(i) {
    const [r, x] = calcZ(i);
    return (r * r + x * x) / x;
}

// group delay in nanoseconds: -dφ/dω of the unwrapped phase, central differences (one-sided at the ends)
export function calcGroupDelay(points) {
    const phase = [];
    let prev = 0, offset = 0;
    points.forEach((p, k) => {
        const a = Math.atan2(p.imag, p.real);
        if (k > 0) {
            if (a - prev > Math.PI) offset -= 2 * Math.PI;
            else if (a - prev < -Math.PI) offset += 2 * Math.PI;
        }
        prev = a;
        phase.push(a + offset);
    });
    return points.map((_, k) => {
        const a = Math.max(k - 1, 0), b = Math.min(k + 1, points.length - 1);
        if (a === b) return NaN;
        return -(phase[b] - phase[a]) / (2 * Math.PI * (points[b].freq - points[a].freq)) * 1e9;
    });
}

export function formatDelay(value) {
    if (!isFinite(value)) return '-';
    return value.toFixed(2) + ' ns';
}

export function formatPlain(value) {
    if (!isFinite(value)) return '∞';
    return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3);
}

// the formats drawn on the frequency chart; the first group has a fixed scale, the others share an automatic axis
export const FREQ_FORMATS = ['logmag', 'phase', 'swr', 'linear', 'real', 'imag', 'R', 'X', 'Z', 'Rp', 'Xp', 'Q', 'gd'];
export const SMITH_FORMATS = ['smith', 'ysmith', 'polar'];

// one value per sweep point for a trace format
export function traceValues(points, format) {
    if (format === 'gd') return calcGroupDelay(points);
    const f = {
        logmag: calcLogMag, swr: calcSWR, phase: calcPhase, linear: calcLinear, real: calcReal, imag: calcImag,
        R: calcZR, X: calcZX, Z: calcZabs, Rp: calcRp, Xp: calcXp, Q: calcQ
    }[format];
    return points.map(f || (() => 0));
}

export function formatTraceValue(format, value) {
    if (format === 'logmag') return formatLogMag(value);
    if (format === 'phase') return formatPhase(value);
    if (format === 'swr') return formatSWR(value);
    if (format === 'gd') return formatDelay(value);
    if (format === 'linear' || format === 'real' || format === 'imag') return formatLinear(value);
    return formatPlain(value) + (['R', 'X', 'Z', 'Rp', 'Xp'].includes(format) ? ' Ω' : '');
}

export function formatFrequency(freq, f = 6) {
    if (freq < 1e3) {
        return freq + ' Hz';
    } else if (freq < 1e6) {
        return (freq / 1e3).toFixed(Math.min(3, f)) + ' kHz';
    } else {
        return (freq / 1e6).toFixed(Math.min(6, f)) + ' MHz';
    }
}

export function formatLogMag(value) {
    return value.toFixed(2) + ' dB';
}

export function formatPhase(value) {
    return value.toFixed(1) + '°';
}

export function formatSWR(value) {
    if (!isFinite(value)) return '∞';
    return value.toFixed(2);
}

export function formatLinear(value) {
    return value.toFixed(4);
}

export function formatReal(value) {
    return value.toFixed(4);
}

export function formatImag(value) {
    return value.toFixed(4);
}
