<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store';
import { CABLE_TYPES } from '../lib/cable';
import { TDR_RANGES, describeRange, computeTdr, strongestReflection } from '../lib/tdr';

const L = 48, R = 12, T = 12, B = 28;
const W = ref(600), H = 260;
const wrap = ref(null);
let observer = null;
const resize = () => { if (wrap.value) W.value = Math.max(280, Math.round(wrap.value.clientWidth) - 24); };
onMounted(() => { resize(); observer = new ResizeObserver(resize); observer.observe(wrap.value); });
onUnmounted(() => { if (observer) observer.disconnect(); });

const tdr = computed(() => {
    store.dataVersion; // recompute on every sweep
    return computeTdr(store.cable.points, store.velocityFactor);
});

const info = (r) => describeRange(r, store.velocityFactor);
const current = computed(() => info(TDR_RANGES[store.tdrPreset]));
const names = { short: 'Short cable', medium: 'Medium cable', long: 'Long cable' };
const fmtM = (v) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' m';

// below this size a peak is sidelobes and noise, not a reflection
const MIN_REFLECTION = 0.05;
const hit = computed(() => {
    const r = tdr.value ? strongestReflection(tdr.value, 2 * tdr.value.resolution) : null;
    return r && Math.abs(r.value) >= MIN_REFLECTION ? r : null;
});

const chart = computed(() => {
    const t = tdr.value;
    if (!t) return null;
    const minD = t.dist[0], maxD = t.dist[t.dist.length - 1];
    const peak = Math.max(0.2, ...t.impulse.map(Math.abs));
    const m = Math.min(1.2, peak * 1.15);
    const x = (d) => L + (d - minD) / (maxD - minD) * (W.value - L - R);
    const y = (v) => T + (1 - (Math.min(Math.max(v, -m), m) + m) / (2 * m)) * (H - T - B);
    return {
        path: t.dist.map((d, i) => (i ? 'L' : 'M') + x(d).toFixed(1) + ' ' + y(t.impulse[i]).toFixed(1)).join(' '),
        zero: y(0),
        yticks: [-m, -m / 2, 0, m / 2, m].map(v => ({ y: y(v), label: v.toFixed(2) })),
        xticks: [0, 0.25, 0.5, 0.75, 1].map(f => ({ x: x(f * maxD), label: fmtM(f * maxD) })),
        origin: x(0),
        mark: hit.value ? { x: x(hit.value.dist), y: y(hit.value.value) } : null,
    };
});

const pickType = (e) => {
    const c = CABLE_TYPES.find(c => c.name === e.target.value);
    if (c) store.velocityFactor = c.vf;
    e.target.value = '';
};
</script>

<template>
  <div class="tdr" ref="wrap">
    <div class="how">Finds where along a cable the signal is reflected: a break (open), a short or water ingress. Connect the cable; the far end can be open, shorted or terminated.</div>

    <div class="row">
      <label>Sweep
        <select v-model="store.tdrPreset" class="input field-input">
          <option v-for="(r, k) in TDR_RANGES" :key="k" :value="k">{{ names[k] }}: up to {{ fmtM(info(r).range) }}, resolution about {{ fmtM(info(r).resolution) }}</option>
        </select>
      </label>
      <label>Velocity factor
        <input type="number" v-model.number="store.velocityFactor" class="input field-input" step="0.01" min="0.1" max="1">
      </label>
      <label>Cable type
        <select class="input field-input" @change="pickType" :value="''">
          <option value="">typical values…</option>
          <option v-for="t in CABLE_TYPES" :key="t.name" :value="t.name">{{ t.name }} ({{ t.vf }})</option>
        </select>
      </label>
    </div>

    <div v-if="!chart" class="empty">{{ store.status === 'connected' ? 'Waiting for measurement…' : 'Connect to the NanoVNA to measure' }}</div>
    <template v-else>
      <div class="tiles">
        <div class="tile" v-if="hit"><span class="label">Strongest reflection</span><span class="value">{{ fmtM(hit.dist) }}</span><span class="sub">{{ hit.kind }}, size {{ hit.value.toFixed(2) }}</span></div>
        <div class="tile" v-else><span class="label">Strongest reflection</span><span class="value small">none found</span><span class="sub">nothing above {{ MIN_REFLECTION }} beyond the connector</span></div>
        <div class="tile"><span class="label">Sweep</span><span class="value small">range {{ fmtM(current.range) }}</span><span class="sub">two reflections closer than {{ fmtM(current.resolution) }} blur into one</span></div>
      </div>
      <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart">
        <g v-for="t in chart.yticks" :key="t.label">
          <line :x1="L" :x2="W - R" :y1="t.y" :y2="t.y" class="grid" />
          <text :x="L - 6" :y="t.y + 4" class="axis" text-anchor="end">{{ t.label }}</text>
        </g>
        <line :x1="L" :x2="W - R" :y1="chart.zero" :y2="chart.zero" class="zero" />
        <text v-for="t in chart.xticks" :key="t.label" :x="t.x" :y="H - 8" class="axis" text-anchor="middle">{{ t.label }}</text>
        <line :x1="chart.origin" :x2="chart.origin" :y1="T" :y2="H - B" class="origin" />
        <path :d="chart.path" class="curve" />
        <circle v-if="chart.mark" :cx="chart.mark.x" :cy="chart.mark.y" r="5" class="min" />
      </svg>
      <div class="sub">Reflections over distance. Up: open or higher impedance. Down: short or lower impedance. The marker is the strongest one beyond the first {{ fmtM(2 * tdr.resolution) }}; the peak at 0 m is the connector.</div>
    </template>

    <div class="sub">Distances are only as good as the velocity factor (typical values are given by cable type; measure yours in the Cable view). The NanoVNA's own delay adds a few tens of cm at 0 m. Bends and splices show as small reflections.</div>
  </div>
</template>

<style scoped>
.tdr { flex: 1; min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 10px; }
.how { font-size: 14px; }
.row { display: flex; flex-wrap: wrap; gap: 12px; }
.row label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-dim); flex: 1; min-width: 180px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.label { font-size: 12px; color: var(--text-dim); }
.value { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
.value.small { font-size: 16px; }
.sub { font-size: 12px; color: var(--text-dim); }
.chart { display: block; max-width: 100%; }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.origin { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 3; }
.zero { stroke: var(--text-dim); stroke-width: 1; }
.axis { font-size: 12px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 2; }
.min { fill: #f44336; }
.empty { padding: 16px; text-align: center; color: var(--text-dim); }
</style>
