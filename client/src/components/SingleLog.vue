<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store';
import { awake } from '../lib/wakelock';
import { slog, logPoints, startLog, stopLog, setLogInterval, clearAll } from '../lib/singlelog';
import { LOG_MAX, LOG_INTERVALS, LOG_WINDOWS, LOG_FORMATS, plotValue, derive, downsample, inWindow, niceScale, clockLabel, durationText, toCsv } from '../lib/tracelog';
import { formatFrequency } from '../lib/dsp';
import ChartFrame from './ChartFrame.vue';
import { useFullChart } from '../lib/fullchart';

const L = 44, R = 12, T = 12, B = 28;
const fc = useFullChart();
const boxW = ref(600), boxH = ref(220);
const W = computed(() => (fc.current.value ? fc.current.value.w : boxW.value));
const H = computed(() => fc.sizeOf('log', 0, boxH.value)[1]);
const wrap = ref(null);
let observer = null;
const resize = () => {
    if (!wrap.value) return;
    boxW.value = Math.max(260, Math.round(wrap.value.clientWidth) - 24);
    boxH.value = Math.round(Math.min(Math.max(boxW.value * 0.45, 200), Math.max(200, window.innerHeight * 0.45)));
};
onMounted(() => {
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(wrap.value);
});
onUnmounted(() => observer && observer.disconnect());

const isOpen = computed(() => store.folds['single-log'] ?? false);
const toggle = () => { store.folds['single-log'] = !isOpen.value; };

const format = ref(store.matchMain === 'rl' ? 'rl' : 'swr'); // a key of LOG_FORMATS
const windowSecs = ref(0);
const cfg = computed(() => LOG_FORMATS[format.value]);

const fmt = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '∞');

const shown = computed(() => {
    slog.version; // recompute with every new point
    return inWindow(logPoints(), windowSecs.value).slice(); // a copy: the log array itself keeps its identity, and a computed that returns the same object does not tell what depends on it
});

// the series of the chosen format; `get` is the value as drawn (limited to what the format shows)
const series = computed(() => cfg.value.series.map(s => ({ cls: s.cls, name: s.name, get: p => plotValue(format.value, s, p) })));

const t0 = computed(() => (shown.value.length ? shown.value[0].t : 0));
const t1 = computed(() => (shown.value.length > 1 ? shown.value[shown.value.length - 1].t : t0.value + 1000));
const span = computed(() => t1.value - t0.value);

const scale = computed(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of series.value) {
        for (const p of shown.value) {
            const v = s.get(p);
            if (!isFinite(v)) continue;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
        }
    }
    const c = cfg.value;
    const sc = niceScale(lo, hi, 4, c.span);
    if (c.min !== undefined && sc.lo < c.min) return niceScale(c.min, Math.max(hi, c.min + c.span), 4, c.span); // SWR is never below 1
    return sc;
});

const x = (t) => L + (t - t0.value) / (span.value || 1) * (W.value - L - R);
const y = (v) => T + (1 - (v - scale.value.lo) / (scale.value.hi - scale.value.lo || 1)) * (H.value - T - B);

const buckets = computed(() => Math.max(20, Math.floor((W.value - L - R) / 2)));
const curves = computed(() => series.value.map((s) => {
    const pts = downsample(shown.value, s.get, buckets.value);
    const gap = Math.max(slog.intervalMs * 5, 15000, 3 * span.value / buckets.value); // a stretch without readings (other view, paused) is not joined up
    let d = '', prev = null;
    for (const p of pts) {
        const v = s.get(p);
        if (!isFinite(v)) continue;
        d += (prev === null || p.t - prev > gap ? 'M' : 'L') + x(p.t).toFixed(1) + ' ' + y(v).toFixed(1) + ' ';
        prev = p.t;
    }
    return { cls: s.cls, d };
}));

const xticks = computed(() => { const n = Math.max(1, Math.min(4, Math.floor((W.value - L - R) / 90))); // a clock label is about 80 px wide with some air
    return Array.from({ length: n + 1 }, (_, i) => i / n).map(f => ({ x: L + f * (W.value - L - R), label: clockLabel(t0.value + f * span.value, span.value) })); });

const unit = computed(() => cfg.value.unit);
const chartTitle = computed(() => cfg.value.title + ' over time');

// tap in the chart: the reading nearest to that time
const cursorT = ref(null);
const onChartClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width * W.value;
    cursorT.value = Math.min(t1.value, Math.max(t0.value, t0.value + (px - L) / (W.value - L - R) * span.value));
};
const cursor = computed(() => {
    if (cursorT.value === null || !shown.value.length) return null;
    const p = shown.value.reduce((a, b) => (Math.abs(b.t - cursorT.value) < Math.abs(a.t - cursorT.value) ? b : a));
    if (p.t < t0.value || p.t > t1.value) return null;
    return p;
});

// the values of the chosen format at the cursor (not limited to what the chart draws)
const cursorText = computed(() => (cursor.value ? cfg.value.series.map(sr => (cfg.value.series.length > 1 || sr.name !== cfg.value.label ? sr.name + ' ' : '') + fmt(sr.get(cursor.value)) + (cfg.value.unit ? ' ' + cfg.value.unit : '')).join(' · ') : ''));

const last = computed(() => { slog.version; const a = logPoints(); return a.length ? a[a.length - 1] : null; });
// the main match value, R and X of a reading
const readout = (p) => { const d = derive(p); return (store.matchMain === 'rl' ? 'RL ' + fmt(d.rl) + ' dB' : 'SWR ' + fmt(d.swr)) + ' · R ' + fmt(d.r, 1) + ' Ω · X ' + fmt(d.x, 1) + ' Ω'; };
// lowest and highest value of the first series of the chosen format in the window
const extremes = computed(() => {
    const first = series.value[0];
    const vs = shown.value.map(first.get).filter(isFinite);
    return vs.length ? { min: Math.min(...vs), max: Math.max(...vs) } : null;
});

const intervalLabel = (ms) => (ms === 0 ? 'every reading' : ms < 60000 ? ms / 1000 + ' s' : ms / 60000 + ' min');
const intervals = computed(() => (LOG_INTERVALS.some(([ms]) => ms === slog.intervalMs) ? LOG_INTERVALS : [...LOG_INTERVALS, [slog.intervalMs, intervalLabel(slog.intervalMs) + ' (raised)']]));

const summary = computed(() => {
    if (slog.running) return 'Running · ' + slog.count.toLocaleString() + ' points';
    return slog.count ? 'Stopped · ' + slog.count.toLocaleString() + ' points' : 'Not started';
});
const runTime = computed(() => { slog.version; const a = logPoints(); return a.length > 1 ? durationText(a[a.length - 1].t - a[0].t) : ''; });

const clear = async () => {
    if (slog.count && !confirm('Delete the log (' + slog.count.toLocaleString() + ' points)? Export it first if you need it.')) return;
    cursorT.value = null;
    await clearAll();
};

const exportCsv = () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    const url = URL.createObjectURL(new Blob([toCsv(logPoints())], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `nanovna-log-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};
</script>

<template>
  <section class="slog" ref="wrap">
    <button class="head" type="button" :aria-expanded="isOpen" @click="toggle">
      <span class="title">Log over time</span>
      <span v-if="!isOpen" class="sum">{{ summary }}</span>
      <span class="chev" :class="{ open: isOpen }" aria-hidden="true"></span>
    </button>

    <div v-show="isOpen" class="body">
      <div class="row">
        <button v-if="!slog.running" class="pill primary" @click="startLog">{{ slog.count ? 'Continue' : 'Start' }}</button>
        <button v-else class="pill primary" @click="stopLog">Stop</button>
        <label class="inline">Every
          <select class="field-input" :value="slog.intervalMs" @change="setLogInterval(+$event.target.value)">
            <option v-for="[ms, label] in intervals" :key="ms" :value="ms">{{ label }}</option>
          </select>
        </label>
        <button class="pill" :disabled="!slog.count" @click="exportCsv">Export CSV</button>
        <button class="pill" :disabled="!slog.count && !slog.running" @click="clear">Clear</button>
      </div>

      <div class="sub">
        <template v-if="last">{{ slog.count.toLocaleString() }} points over {{ runTime || '0 s' }} at {{ formatFrequency(last.f, 6) }}. Latest: {{ readout(last) }}</template>
        <template v-else>Records the reading of the chosen frequency while this view is open. The log stays in this browser, also after a reload.</template>
      </div>
      <div v-if="slog.running && store.status !== 'connected'" class="sub warn">Waiting for the NanoVNA: nothing is recorded while it is not connected.</div>
      <div v-if="slog.running && !awake.active" class="sub">
        The screen turning off or another app in front pauses the log.
        <button v-if="awake.supported && !store.keepAwake" class="pill" @click="store.keepAwake = true">Keep screen on</button>
        <template v-else-if="!awake.supported">Your browser keeps the screen on only on HTTPS pages, so leave the screen unlocked.</template>
      </div>
      <div v-if="slog.raisedFrom !== 0" class="sub">Over {{ LOG_MAX.toLocaleString() }} points: the log was thinned to every second point, now one point every {{ intervalLabel(slog.intervalMs) }}.</div>
      <div v-if="!slog.stored" class="sub warn">The browser did not store the log (private window or no space). Export it before you close the page.</div>

      <template v-if="slog.count > 1">
        <div class="row">
          <label class="inline">Show
            <select v-model="format" class="field-input">
              <option v-for="(f, key) in LOG_FORMATS" :key="key" :value="key">{{ f.label }}</option>
            </select>
          </label>
          <span class="spacer"></span>
          <button v-for="[s, label] in LOG_WINDOWS" :key="s" class="pill choice" :class="{ active: windowSecs === s }" @click="windowSecs = s">{{ label }}</button>
        </div>
        <div class="label">{{ chartTitle }}<span v-if="cursor" class="readout"> · {{ clockLabel(cursor.t, 0) }} {{ cursorText }}</span><span v-else-if="extremes" class="readout"> · min {{ fmt(extremes.min) }} · max {{ fmt(extremes.max) }}{{ unit ? ' ' + unit : '' }}</span></div>
        <ChartFrame :title="chartTitle" @change="(s) => fc.onFrame('log', s)">
          <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart" @click="onChartClick">
            <g v-for="t in scale.ticks" :key="t">
              <line :x1="L" :x2="W - R" :y1="y(t)" :y2="y(t)" class="grid" />
              <text :x="L - 6" :y="y(t) + 4" class="axis" text-anchor="end">{{ t.toFixed(scale.decimals) }}</text>
            </g>
            <text v-for="t in xticks" :key="t.x" :x="t.x" :y="H - 8" class="axis" :text-anchor="t.x < L + 4 ? 'start' : t.x > W - R - 4 ? 'end' : 'middle'">{{ t.label }}</text>
            <path v-for="c in curves" :key="c.cls" :d="c.d" :class="c.cls" />
            <template v-if="cursor">
              <line :x1="x(cursor.t)" :x2="x(cursor.t)" :y1="T" :y2="H - B" class="cursor" />
              <circle v-for="s in series" :key="s.cls" :cx="x(cursor.t)" :cy="y(Math.min(Math.max(s.get(cursor), scale.lo), scale.hi))" r="5" class="cursor-dot" />
            </template>
          </svg>
        </ChartFrame>
      </template>
    </div>
  </section>
</template>

<style scoped>
.slog { display: flex; flex-direction: column; gap: 8px; }
.head { display: flex; align-items: center; gap: 8px; min-height: var(--tap); padding: 0 14px; border: 0; border-radius: 8px; background: var(--tile-bg); color: var(--text-main); font: inherit; text-align: left; cursor: pointer; }
.title { font-size: 14px; font-weight: 500; white-space: nowrap; }
.sum { flex: 1; min-width: 0; font-size: 13px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.title + .chev { margin-left: auto; }
.sum + .chev { margin-left: 0; }
.chev { flex: none; width: 7px; height: 7px; border-right: 1.5px solid var(--text-dim); border-bottom: 1.5px solid var(--text-dim); opacity: 0.7; transform: rotate(45deg) translate(-2px, -2px); transition: transform 0.15s; }
.chev.open { transform: rotate(225deg) translate(-2px, -2px); }
.body { display: flex; flex-direction: column; gap: 8px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.inline { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim); }
.spacer { flex: 1; }
.pill.primary, .pill.choice.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.sub { font-size: 12px; color: var(--text-dim); }
.warn { color: #f44336; }
.label { font-size: 12px; color: var(--text-dim); }
.readout { color: var(--text-main); font-weight: 500; }
.chart { display: block; max-width: 100%; touch-action: manipulation; }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.axis { font-size: 12px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 2; }
.curve-x { fill: none; stroke: #ff9800; stroke-width: 2; }
.cursor { stroke: var(--text-main); stroke-width: 1.5; }
.cursor-dot { fill: var(--text-main); stroke: var(--surface-color); stroke-width: 2; }
</style>
