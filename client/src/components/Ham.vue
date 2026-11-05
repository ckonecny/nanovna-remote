<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store';
import CalStatus from './CalStatus.vue';
import CalPanel from './CalPanel.vue';
import ChartFrame from './ChartFrame.vue';
import { useFullChart } from '../lib/fullchart';
import { HAM_BANDS } from '../lib/bands';
import { resonance, SWR_LIMITS } from '../lib/resonance';
import { calcSWR, calcZ, calcLogMag, formatFrequency } from '../lib/dsp';

const emit = defineEmits(['select-band', 'edit-cursor']);

const SWR_MAX = 5;
const L = 44, R = 12, T = 12, B = 28;
// the chart is drawn 1:1 in pixels at whatever size the page gives it, from a phone to a full screen display
const fc = useFullChart();
const boxW = ref(600), boxH = ref(300);
const W = computed(() => (fc.current.value ? fc.current.value.w : boxW.value));
const H = computed(() => fc.sizeOf('swr', 0, boxH.value)[1]);
const wrap = ref(null);
let observer = null;
const resize = () => {
    if (!wrap.value) return;
    boxW.value = Math.max(280, Math.round(wrap.value.clientWidth) - 24); // minus the padding
    boxH.value = Math.round(Math.min(Math.max(boxW.value * 0.5, 220), Math.max(220, window.innerHeight * 0.5)));
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

const band = computed(() => HAM_BANDS.find(b => b.name === store.hamBand) || HAM_BANDS[0]);

const points = computed(() => {
    store.dataVersion; // recompute on every sweep
    return store.data.ch0.map((p) => {
        const [r, xr] = calcZ(p);
        return { ...p, swr: calcSWR(p), rl: -calcLogMag(p), r, xr };
    });
});

const fmin = computed(() => points.value.length ? points.value[0].freq : band.value.start);
const fmax = computed(() => points.value.length ? points.value[points.value.length - 1].freq : band.value.stop);

const x = (f) => L + (f - fmin.value) / (fmax.value - fmin.value || 1) * (W.value - L - R);
const y = (swr) => T + (1 - (Math.min(swr, SWR_MAX) - 1) / (SWR_MAX - 1)) * (H.value - T - B);

const path = computed(() => points.value.map((p, i) => (i ? 'L' : 'M') + x(p.freq).toFixed(1) + ' ' + y(p.swr).toFixed(1)).join(' '));

const inBand = computed(() => points.value.filter(p => p.freq >= band.value.start && p.freq <= band.value.stop));

const minPoint = computed(() => inBand.value.length ? inBand.value.reduce((a, p) => p.swr < a.swr ? p : a) : null);
const maxPoint = computed(() => inBand.value.length ? inBand.value.reduce((a, p) => p.swr > a.swr ? p : a) : null);

const nearest = (f) => points.value.length ? points.value.reduce((a, p) => Math.abs(p.freq - f) < Math.abs(a.freq - f) ? p : a) : null;
const lowEdge = computed(() => nearest(band.value.start));
const highEdge = computed(() => nearest(band.value.stop));

// lowest SWR in the band and the stretch around it that stays at or below the chosen limit
const res = computed(() => resonance(points.value, inBand.value, store.swrLimit));
const bw = computed(() => (res.value ? res.value.bandwidth : null));
const bwText = computed(() => {
    const b = bw.value;
    if (!b) return 'none';
    return formatFrequency(b.from, 3) + ' – ' + formatFrequency(b.to, 3);
});
const bwWidth = computed(() => {
    const b = bw.value;
    if (!b) return '';
    const w = b.width >= 1e6 ? (b.width / 1e6).toFixed(3) + ' MHz' : (b.width / 1e3).toFixed(1) + ' kHz';
    return (b.lowOpen || b.highOpen ? '≥ ' : '') + w;
});

// The cursor is either set by hand (store.hamCursor: tap in a chart or the keypad; it sits on the measured point nearest to that
// frequency) or follows the lowest / highest SWR in the band with every sweep (store.hamCursorMode, like the NanoVNA's marker search)
const cursor = computed(() => {
    let p = null;
    if (store.hamCursorMode === 'min') p = minPoint.value;
    else if (store.hamCursorMode === 'max') p = maxPoint.value;
    else {
        const f = store.hamCursor;
        if (f !== null && points.value.length && f >= fmin.value && f <= fmax.value) p = nearest(f);
    }
    return p ? { p } : null;
});

const setMode = (mode) => {
    if (mode === 'manual' && cursor.value) store.hamCursor = cursor.value.p.freq; // keep the cursor where it is
    store.hamCursorMode = mode;
};

const onChartClick = (event) => {
    store.hamCursorMode = 'manual';
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * W.value;
    const f = fmin.value + (px - L) / (W.value - L - R) * (fmax.value - fmin.value);
    store.hamCursor = Math.min(fmax.value, Math.max(fmin.value, f));
};

// additional charts under the SWR chart; each has its own y scale but shares the frequency axis
const EXTRAS = [['rl', 'Return loss'], ['rx', 'R / X']];
const toggleExtra = (id) => {
    const i = store.hamExtras.indexOf(id);
    if (i >= 0) store.hamExtras.splice(i, 1);
    else store.hamExtras.push(id);
};
const ehOf = (id) => fc.sizeOf(id, 0, 160)[1]; // only the chart that is full gets the height of the screen
const extraCharts = computed(() => store.hamExtras.map((id) => {
    const pts = points.value;
    const line = (key, scale) => pts.map((p, i) => (i ? 'L' : 'M') + x(p.freq).toFixed(1) + ' ' + scale(p[key]).toFixed(1)).join(' ');
    if (id === 'rl') {
        const RL_MAX = 30; // dB, 0 at the top so that a notch dips like in the SWR chart
        const yy = (v) => T + Math.min(Math.max(v, 0), RL_MAX) / RL_MAX * (ehOf(id) - T - B);
        const p = cursor.value && cursor.value.p;
        return {
            id, title: 'Return loss (dB)', ticks: [0, 10, 20, 30].map(v => ({ y: yy(v), label: String(v) })), zero: null, curves: [{ d: line('rl', yy), cls: 'curve' }],
            marks: p ? [{ y: yy(p.rl), text: fmt(p.rl) + ' dB' }] : [],
            readout: p ? 'Return loss ' + fmt(p.rl) + ' dB' : '',
        };
    }
    const cp = cursor.value && cursor.value.p;
    const reach = Math.max(0, ...pts.flatMap(p => [Math.abs(p.r), Math.abs(p.xr)]).filter(isFinite));
    const m = [50, 100, 200, 500].find(v => reach <= v) || 500; // symmetric scale, values beyond it are clipped
    const yy = (v) => T + (1 - (Math.min(Math.max(v, -m), m) + m) / (2 * m)) * (ehOf(id) - T - B);
    return {
        id, title: 'R (blue) / X (orange) in Ω',
        ticks: [-m, -m / 2, 0, m / 2, m].map(v => ({ y: yy(v), label: String(v) })),
        zero: yy(0),
        curves: [{ d: line('r', yy), cls: 'curve' }, { d: line('xr', yy), cls: 'curve-x' }],
        marks: cp ? [{ y: yy(cp.r), text: 'R ' + fmt(cp.r) }, { y: yy(cp.xr), text: 'X ' + fmt(cp.xr), cls: 'dot-x' }] : [],
        readout: cp ? 'R ' + fmt(cp.r) + ' Ω · X ' + fmt(cp.xr) + ' Ω' : '',
    };
}));

const fmt = (v) => (isFinite(v) ? v.toFixed(2) : '∞');
const grid = [1, 1.5, 2, 3, 5];
const xticks = computed(() => [0, 0.25, 0.5, 0.75, 1].map(t => fmin.value + t * (fmax.value - fmin.value)));
</script>

<template>
  <div class="ham" ref="wrap">
    <CalStatus :bands="[store.hamBand]" />

    <div class="bands">
      <button v-for="b in HAM_BANDS" :key="b.name" class="band pill" :class="{ active: b.name === store.hamBand }" @click="emit('select-band', b)">{{ b.name }}</button>
    </div>

    <div class="extras">
      <span class="label">SWR limit</span>
      <button v-for="l in SWR_LIMITS" :key="l" class="band pill" :class="{ active: store.swrLimit === l }" @click="store.swrLimit = l">{{ l }}</button>
    </div>

    <div class="cursorbar">
      <div v-if="cursor" class="cursor-values">
        <span class="cursor-freq">{{ formatFrequency(cursor.p.freq, 4) }}</span>
        <span>SWR {{ fmt(cursor.p.swr) }}</span>
        <span>RL {{ fmt(cursor.p.rl) }} dB</span>
        <span>R {{ fmt(cursor.p.r) }} Ω</span>
        <span>X {{ fmt(cursor.p.xr) }} Ω</span>
      </div>
      <span v-else class="sub">Tap a chart to place a cursor, enter a frequency, or let it follow the minimum or maximum SWR.</span>
      <div class="cursor-btns">
        <button class="band pill" :class="{ active: store.hamCursorMode === 'manual' }" @click="setMode('manual')">Manual</button>
        <button class="band pill" :class="{ active: store.hamCursorMode === 'min' }" @click="setMode('min')" title="Follows the lowest SWR in the band">Min</button>
        <button class="band pill" :class="{ active: store.hamCursorMode === 'max' }" @click="setMode('max')" title="Follows the highest SWR in the band">Max</button>
        <button class="pill" @click="emit('edit-cursor', cursor ? cursor.p.freq : (band.start + band.stop) / 2)">Frequency…</button>
        <button v-if="store.hamCursorMode === 'manual' && cursor" class="pill" @click="store.hamCursor = null">Clear</button>
      </div>
    </div>

    <ChartFrame :title="'SWR ' + band.name" @change="(s) => fc.onFrame('swr', s)">
    <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart" @click="onChartClick">
      <rect :x="x(band.start)" :y="T" :width="Math.max(0, x(band.stop) - x(band.start))" :height="H - T - B" class="band-area" />
      <g v-for="g in grid" :key="g">
        <line :x1="L" :x2="W - R" :y1="y(g)" :y2="y(g)" class="grid" />
        <text :x="L - 6" :y="y(g) + 4" class="axis" text-anchor="end">{{ g }}</text>
      </g>
      <rect v-if="bw" :x="x(bw.from)" :y="T" :width="Math.max(1, x(bw.to) - x(bw.from))" :height="H - T - B" class="bw-area" />
      <line :x1="L" :x2="W - R" :y1="y(store.swrLimit)" :y2="y(store.swrLimit)" class="grid2" />
      <text :x="W - R - 4" :y="y(store.swrLimit) - 4" class="limit-label" text-anchor="end">SWR {{ store.swrLimit }}</text>
      <text v-for="f in xticks" :key="f" :x="x(f)" :y="H - 8" class="axis" text-anchor="middle">{{ (f / 1e6).toFixed(f < 20e6 ? 3 : 2) }}</text>
      <path :d="path" class="curve" />
      <circle v-if="minPoint" :cx="x(minPoint.freq)" :cy="y(minPoint.swr)" r="5" class="min" />
      <line v-if="cursor" :x1="x(cursor.p.freq)" :x2="x(cursor.p.freq)" :y1="T" :y2="H - B" class="cursor" />
      <circle v-if="cursor" :cx="x(cursor.p.freq)" :cy="y(cursor.p.swr)" r="6" class="cursor-dot" />
      <text v-if="cursor" :x="x(cursor.p.freq) + (x(cursor.p.freq) > W / 2 ? -10 : 10)" :y="T + 14" class="cursor-label" :text-anchor="x(cursor.p.freq) > W / 2 ? 'end' : 'start'">SWR {{ fmt(cursor.p.swr) }}</text>
    </svg>
    </ChartFrame>

    <div v-if="!points.length" class="empty">{{ store.status === 'connected' ? 'Waiting for measurement…' : 'Connect to the NanoVNA to measure' }}</div>
    <div v-else class="tiles">
      <div class="tile" v-if="minPoint"><span class="label">Resonance (minimum SWR)</span><span class="value">{{ fmt(minPoint.swr) }}</span><span class="sub">at {{ formatFrequency(minPoint.freq, 4) }} · {{ fmt(minPoint.r) }} {{ minPoint.xr < 0 ? '−' : '+' }} j{{ fmt(Math.abs(minPoint.xr)) }} Ω</span></div>
      <div class="tile"><span class="label">Bandwidth, SWR ≤ {{ store.swrLimit }}</span><span class="value small">{{ bwText }}</span><span v-if="bw" class="sub">{{ bwWidth }} wide{{ bw.lowOpen || bw.highOpen ? ' (reaches the end of the sweep)' : '' }}</span></div>
      <div class="tile" v-if="lowEdge"><span class="label">Lower band edge</span><span class="value">{{ fmt(lowEdge.swr) }}</span><span class="sub">{{ formatFrequency(band.start, 3) }}</span></div>
      <div class="tile" v-if="highEdge"><span class="label">Upper band edge</span><span class="value">{{ fmt(highEdge.swr) }}</span><span class="sub">{{ formatFrequency(band.stop, 3) }}</span></div>
    </div>

    <div class="extras">
      <span class="label">Also show</span>
      <button v-for="[id, name] in EXTRAS" :key="id" class="band pill" :class="{ active: store.hamExtras.includes(id) }" @click="toggleExtra(id)">{{ name }}</button>
    </div>
    <div v-for="c in extraCharts" :key="c.id" class="extra">
      <div class="label">{{ c.title }}<span v-if="c.readout" class="readout"> · {{ c.readout }}</span></div>
      <ChartFrame :title="c.title" @change="(s) => fc.onFrame(c.id, s)">
      <svg :viewBox="`0 0 ${W} ${ehOf(c.id)}`" :width="W" :height="ehOf(c.id)" class="chart" @click="onChartClick">
        <rect :x="x(band.start)" :y="T" :width="Math.max(0, x(band.stop) - x(band.start))" :height="ehOf(c.id) - T - B" class="band-area" />
        <g v-for="t in c.ticks" :key="t.label">
          <line :x1="L" :x2="W - R" :y1="t.y" :y2="t.y" class="grid" />
          <text :x="L - 6" :y="t.y + 4" class="axis" text-anchor="end">{{ t.label }}</text>
        </g>
        <line v-if="c.zero !== null" :x1="L" :x2="W - R" :y1="c.zero" :y2="c.zero" class="grid2" />
        <path v-for="(cv, i) in c.curves" :key="i" :d="cv.d" :class="cv.cls" />
        <line v-if="cursor" :x1="x(cursor.p.freq)" :x2="x(cursor.p.freq)" :y1="T" :y2="ehOf(c.id) - B" class="cursor" />
        <g v-if="cursor">
          <circle v-for="m in c.marks" :key="m.text" :cx="x(cursor.p.freq)" :cy="m.y" r="5" :class="['cursor-dot', m.cls]" />
          <text v-for="(m, i) in c.marks" :key="'t' + m.text" :x="x(cursor.p.freq) + (x(cursor.p.freq) > W / 2 ? -10 : 10)" :y="T + 14 + i * 16" class="cursor-label" :text-anchor="x(cursor.p.freq) > W / 2 ? 'end' : 'start'">{{ m.text }}</text>
        </g>
      </svg>
      </ChartFrame>
    </div>

    <CalPanel />
  </div>
</template>

<style scoped>
.ham { flex: 1; min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 10px; }
.bands { display: flex; flex-wrap: wrap; gap: 6px; }
.band.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.chart { display: block; max-width: 100%; touch-action: manipulation; }
.band-area { fill: var(--band-area); }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.grid2 { stroke: rgba(244, 67, 54, 0.5); stroke-dasharray: 4 3; }
.axis { font-size: 12px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 2; }
.min { fill: #f44336; }
.bw-area { fill: rgba(33, 150, 243, 0.2); }
.limit-label { font-size: 11px; fill: rgba(244, 67, 54, 0.9); }
.curve-x { fill: none; stroke: #ff9800; stroke-width: 2; }
.extras { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.extra { display: flex; flex-direction: column; gap: 4px; }
.cursor { stroke: var(--text-main); stroke-width: 1.5; }
.cursor-dot { fill: var(--text-main); stroke: var(--surface-color); stroke-width: 2; }
.cursor-label { font-size: 13px; font-weight: 500; fill: var(--text-main); paint-order: stroke; stroke: var(--surface-color); stroke-width: 4px; }
.cursorbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; padding: 6px 10px; border-radius: 8px; background: var(--tile-bg); min-height: calc(var(--tap) + 12px); }
.cursor-values { flex: 1 1 200px; display: flex; flex-wrap: wrap; gap: 2px 12px; font-variant-numeric: tabular-nums; font-size: 14px; }
.cursor-freq { font-weight: 500; }
.dot-x { fill: #ff9800; }
.readout { color: var(--text-main); text-transform: none; font-weight: 500; }
.cursor-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.tile.wide { grid-column: 1 / -1; }
.label { font-size: 12px; color: var(--text-dim); }
.value { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
.value.small { font-size: 16px; }
.sub { font-size: 12px; color: var(--text-dim); }
.empty { padding: 16px; text-align: center; color: var(--text-dim); }
</style>
