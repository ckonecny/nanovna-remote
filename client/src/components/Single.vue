<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { calcSWR, calcLogMag, calcZ, calcLinear, calcPhase, formatFrequency } from '../lib/dsp';
import { formatZ } from '../lib/valuefmt';

const emit = defineEmits(['edit-frequency']);

// the point of the current sweep closest to the chosen frequency (the sweep is centred on it, see App.vue)
const point = computed(() => {
    store.dataVersion; // recompute on every sweep
    const data = store.data.ch0;
    if (!data.length) return null;
    return data.reduce((best, p) => Math.abs(p.freq - store.singleFreq) < Math.abs(best.freq - store.singleFreq) ? p : best);
});

const fmt = (v, digits = 2) => (isFinite(v) ? v.toFixed(digits) : '∞');

const values = computed(() => {
    const p = point.value;
    if (!p) return null;
    const [r, x] = calcZ(p);
    const w = 2 * Math.PI * p.freq;
    const swr = calcSWR(p);
    return {
        swr,
        rl: -calcLogMag(p),
        zabs: Math.hypot(r, x),
        r,
        x,
        reactive: x < 0 ? { label: 'C', value: fmtCapacitance(-1 / (w * x)) } : { label: 'L', value: fmtInductance(x / w) },
        gamma: calcLinear(p),
        phase: calcPhase(p),
        swrClass: swr < 1.5 ? 'good' : swr < 3 ? 'warn' : 'bad',
    };
});

function fmtCapacitance(c) {
    if (c < 1e-9) return (c * 1e12).toFixed(1) + ' pF';
    if (c < 1e-6) return (c * 1e9).toFixed(2) + ' nF';
    return (c * 1e6).toFixed(2) + ' µF';
}

function fmtInductance(l) {
    if (l < 1e-6) return (l * 1e9).toFixed(1) + ' nH';
    if (l < 1e-3) return (l * 1e6).toFixed(2) + ' µH';
    return (l * 1e3).toFixed(2) + ' mH';
}
</script>

<template>
  <div class="single">
    <button class="freq" @click="emit('edit-frequency')">
      <span class="label">Frequency</span>
      <span class="value">{{ formatFrequency(store.singleFreq, 6) }}</span>
    </button>

    <div v-if="!values" class="empty">{{ store.status === 'connected' ? 'Waiting for measurement…' : 'Connect to the NanoVNA to measure' }}</div>
    <div v-else class="tiles">
      <div class="tile swr" :class="values.swrClass">
        <span class="label">{{ store.matchMain === 'rl' ? 'Return loss' : 'SWR' }}</span>
        <span class="value">{{ store.matchMain === 'rl' ? fmt(values.rl) + ' dB' : fmt(values.swr) }}</span>
      </div>
      <div class="tile"><span class="label">{{ store.matchMain === 'rl' ? 'SWR' : 'Return loss' }}</span><span class="value">{{ store.matchMain === 'rl' ? fmt(values.swr) : fmt(values.rl) + ' dB' }}</span></div>
      <div class="tile z"><span class="label">Z</span><span class="value">{{ formatZ(values.r, values.x, store.zFormat) }}</span></div>
      <template v-if="store.zFormat === 'polar'">
        <div class="tile"><span class="label">R</span><span class="value">{{ fmt(values.r) }} Ω</span></div>
        <div class="tile"><span class="label">X</span><span class="value">{{ fmt(values.x) }} Ω</span></div>
      </template>
      <template v-else>
        <div class="tile"><span class="label">|Z|</span><span class="value">{{ fmt(values.zabs) }} Ω</span></div>
        <div class="tile"><span class="label">Z angle</span><span class="value">{{ fmt(Math.atan2(values.x, values.r) * 180 / Math.PI, 1) }}°</span></div>
      </template>
      <div class="tile"><span class="label">{{ values.reactive.label }} (series)</span><span class="value">{{ values.reactive.value }}</span></div>
      <div class="tile"><span class="label">|Γ|</span><span class="value">{{ fmt(values.gamma, 3) }}</span></div>
      <div class="tile"><span class="label">Phase</span><span class="value">{{ fmt(values.phase, 1) }}°</span></div>
    </div>
  </div>
</template>

<style scoped>
.single { padding: 12px; display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 900px; margin: 0 auto; }
.freq { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; background: transparent; color: var(--text-main); cursor: pointer; }
.freq .value { font-size: 32px; font-weight: 500; font-variant-numeric: tabular-nums; }
.label { font-size: 12px; color: var(--text-dim); }
.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.tile .value { font-size: 22px; font-weight: 500; font-variant-numeric: tabular-nums; }
.tile.swr, .tile.z { grid-column: 1 / -1; align-items: center; }
.tile.swr .value { font-size: 52px; }
.tile.good { background: var(--good-bg); }
.tile.warn { background: var(--warn-bg); }
.tile.bad { background: var(--bad-bg); }
.empty { padding: 24px; text-align: center; color: var(--text-dim); }
</style>
