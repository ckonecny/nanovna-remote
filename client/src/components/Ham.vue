<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store';
import CalStatus from './CalStatus.vue';
import CalPanel from './CalPanel.vue';
import { HAM_BANDS } from '../lib/bands';
import { calcSWR, calcZ, formatFrequency } from '../lib/dsp';

const emit = defineEmits(['select-band']);

const SWR_MAX = 5;
const L = 44, R = 12, T = 12, B = 28;
// the chart is drawn 1:1 in pixels at whatever size the page gives it, from a phone to a full screen display
const W = ref(600), H = ref(300);
const wrap = ref(null);
let observer = null;
const resize = () => {
    if (!wrap.value) return;
    W.value = Math.max(280, Math.round(wrap.value.clientWidth) - 24); // minus the padding
    H.value = Math.round(Math.min(Math.max(W.value * 0.5, 220), Math.max(220, window.innerHeight * 0.5)));
};
onMounted(() => {
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(wrap.value);
    window.addEventListener('resize', resize);
});
onUnmounted(() => {
    if (observer) observer.disconnect();
    window.removeEventListener('resize', resize);
});
const cursorFreq = ref(null);

const band = computed(() => HAM_BANDS.find(b => b.name === store.hamBand) || HAM_BANDS[0]);

const points = computed(() => {
    store.dataVersion; // recompute on every sweep
    return store.data.ch0.map(p => ({ ...p, swr: calcSWR(p) }));
});

const fmin = computed(() => points.value.length ? points.value[0].freq : band.value.start);
const fmax = computed(() => points.value.length ? points.value[points.value.length - 1].freq : band.value.stop);

const x = (f) => L + (f - fmin.value) / (fmax.value - fmin.value || 1) * (W.value - L - R);
const y = (swr) => T + (1 - (Math.min(swr, SWR_MAX) - 1) / (SWR_MAX - 1)) * (H.value - T - B);

const path = computed(() => points.value.map((p, i) => (i ? 'L' : 'M') + x(p.freq).toFixed(1) + ' ' + y(p.swr).toFixed(1)).join(' '));

const inBand = computed(() => points.value.filter(p => p.freq >= band.value.start && p.freq <= band.value.stop));

const minPoint = computed(() => inBand.value.length ? inBand.value.reduce((a, p) => p.swr < a.swr ? p : a) : null);

const nearest = (f) => points.value.length ? points.value.reduce((a, p) => Math.abs(p.freq - f) < Math.abs(a.freq - f) ? p : a) : null;
const lowEdge = computed(() => nearest(band.value.start));
const highEdge = computed(() => nearest(band.value.stop));

// widest stretch of the band where SWR stays at or below 2
const swr2 = computed(() => {
    let best = null, cur = null;
    for (const p of inBand.value) {
        if (p.swr <= 2) {
            cur = cur ? { from: cur.from, to: p.freq } : { from: p.freq, to: p.freq };
            if (!best || cur.to - cur.from > best.to - best.from) best = { ...cur };
        } else cur = null;
    }
    return best;
});

const cursor = computed(() => {
    if (cursorFreq.value === null) return null;
    const p = nearest(cursorFreq.value);
    if (!p) return null;
    const [r, xr] = calcZ(p);
    return { p, r, x: xr };
});

const onChartClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * W.value;
    cursorFreq.value = fmin.value + (px - L) / (W.value - L - R) * (fmax.value - fmin.value);
};

const fmt = (v) => (isFinite(v) ? v.toFixed(2) : '∞');
const grid = [1, 1.5, 2, 3, 5];
const xticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map(t => fmin.value + t * (fmax.value - fmin.value)));
</script>

<template>
  <div class="ham" ref="wrap">
    <CalStatus :bands="[store.hamBand]" />

    <div class="bands">
      <button v-for="b in HAM_BANDS" :key="b.name" class="band" :class="{ active: b.name === store.hamBand }" @click="emit('select-band', b)">{{ b.name }}</button>
    </div>

    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart" @click="onChartClick">
      <rect :x="x(band.start)" :y="T" :width="Math.max(0, x(band.stop) - x(band.start))" :height="H - T - B" class="band-area" />
      <g v-for="g in grid" :key="g">
        <line :x1="L" :x2="W - R" :y1="y(g)" :y2="y(g)" :class="['grid', g === 2 && 'grid2']" />
        <text :x="L - 6" :y="y(g) + 4" class="axis" text-anchor="end">{{ g }}</text>
      </g>
      <text v-for="f in xticks" :key="f" :x="x(f)" :y="H - 8" class="axis" text-anchor="middle">{{ (f / 1e6).toFixed(f < 20e6 ? 3 : 2) }}</text>
      <path :d="path" class="curve" />
      <circle v-if="minPoint" :cx="x(minPoint.freq)" :cy="y(minPoint.swr)" r="5" class="min" />
      <line v-if="cursor" :x1="x(cursor.p.freq)" :x2="x(cursor.p.freq)" :y1="T" :y2="H - B" class="cursor" />
    </svg>

    <div v-if="!points.length" class="empty">{{ store.status === 'connected' ? 'Waiting for measurement…' : 'Connect to the NanoVNA to measure' }}</div>
    <div v-else class="tiles">
      <div class="tile" v-if="minPoint"><span class="label">Minimum SWR</span><span class="value">{{ fmt(minPoint.swr) }}</span><span class="sub">at {{ formatFrequency(minPoint.freq, 4) }}</span></div>
      <div class="tile"><span class="label">SWR ≤ 2</span><span class="value small">{{ swr2 ? formatFrequency(swr2.from, 3) + ' – ' + formatFrequency(swr2.to, 3) : 'none in band' }}</span></div>
      <div class="tile" v-if="lowEdge"><span class="label">Lower band edge</span><span class="value">{{ fmt(lowEdge.swr) }}</span><span class="sub">{{ formatFrequency(band.start, 3) }}</span></div>
      <div class="tile" v-if="highEdge"><span class="label">Upper band edge</span><span class="value">{{ fmt(highEdge.swr) }}</span><span class="sub">{{ formatFrequency(band.stop, 3) }}</span></div>
      <div class="tile wide" v-if="cursor">
        <span class="label">Cursor {{ formatFrequency(cursor.p.freq, 4) }}</span>
        <span class="value small">SWR {{ fmt(cursor.p.swr) }} · R {{ fmt(cursor.r) }} Ω · X {{ fmt(cursor.x) }} Ω</span>
      </div>
    </div>

    <CalPanel />
  </div>
</template>

<style scoped>
.ham { flex: 1; min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 10px; }
.bands { display: flex; flex-wrap: wrap; gap: 6px; }
.band { padding: 6px 12px; border-radius: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-main); font-size: 14px; cursor: pointer; }
.band.active { background: #3f51b5; color: #fff; border-color: #3f51b5; }
.chart { display: block; max-width: 100%; touch-action: manipulation; }
.band-area { fill: var(--band-area); }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.grid2 { stroke: rgba(244, 67, 54, 0.5); stroke-dasharray: 4 3; }
.axis { font-size: 12px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 2; }
.min { fill: #f44336; }
.cursor { stroke: var(--text-dim); stroke-width: 1; stroke-dasharray: 3 3; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.tile.wide { grid-column: 1 / -1; }
.label { font-size: 12px; color: var(--text-dim); text-transform: uppercase; }
.value { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
.value.small { font-size: 16px; }
.sub { font-size: 12px; color: var(--text-dim); }
.empty { padding: 16px; text-align: center; color: var(--text-dim); }
</style>
