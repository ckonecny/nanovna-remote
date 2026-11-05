<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { HAM_BANDS } from '../lib/bands';
import CalStatus from './CalStatus.vue';
import CalPanel from './CalPanel.vue';
import ChartFrame from './ChartFrame.vue';
import { useFullChart } from '../lib/fullchart';
import { calcSWR, formatFrequency } from '../lib/dsp';
import { resonance, SWR_LIMITS } from '../lib/resonance';

const SWR_MAX = 5;
const W = 300, H = 110, L = 22, R = 6, T = 6, B = 6;
const fc = useFullChart(); // a card can fill the screen: its chart is then drawn at the size of the screen

const toggle = (name) => {
    const i = store.multiBands.indexOf(name);
    if (i >= 0) store.multiBands.splice(i, 1);
    else store.multiBands.push(name);
    store.multiBands.sort((a, b) => HAM_BANDS.findIndex(x => x.name === a) - HAM_BANDS.findIndex(x => x.name === b));
};

const cards = computed(() => {
    store.dataVersion; // recompute on every sweep
    return store.multiBands.map((name) => {
        const band = HAM_BANDS.find(b => b.name === name);
        const m = store.multi[name];
        if (!band) return null;
        const points = m ? m.points.map(p => ({ freq: p.freq, swr: calcSWR(p) })) : [];
        const inBand = points.filter(p => p.freq >= band.start && p.freq <= band.stop);
        const res = resonance(points, inBand, store.swrLimit);
        const min = res ? res.min : null;
        const bw = res ? res.bandwidth : null;
        const f0 = points.length ? points[0].freq : band.start, f1 = points.length ? points[points.length - 1].freq : band.stop;
        const [w, h] = fc.sizeOf(name, W, H);
        const x = (f) => L + (f - f0) / (f1 - f0 || 1) * (w - L - R);
        const y = (swr) => T + (1 - (Math.min(swr, SWR_MAX) - 1) / (SWR_MAX - 1)) * (h - T - B);
        return {
            W: w, H: h, full: fc.isFull(name),
            band, points, min, bw, calibrated: m ? m.calibrated : false, measured: !!m,
            path: points.map((p, i) => (i ? 'L' : 'M') + x(p.freq).toFixed(1) + ' ' + y(p.swr).toFixed(1)).join(' '),
            bandX: x(band.start), bandW: Math.max(0, x(band.stop) - x(band.start)),
            y,
            bwX: bw ? x(bw.from) : 0, bwW: bw ? Math.max(1, x(bw.to) - x(bw.from)) : 0,
            minX: min ? x(min.freq) : 0,
            cls: !min ? '' : min.swr < 1.5 ? 'good' : min.swr < 3 ? 'warn' : 'bad',
        };
    }).filter(Boolean);
});

const fmt = (v) => (!isFinite(v) ? '∞' : v > 99 ? '> 99' : v.toFixed(2));
const grid = [1, 2, 3, 5];
</script>

<template>
  <div class="multi">
    <CalStatus :bands="store.multiBands" />

    <div class="bands">
      <button v-for="b in HAM_BANDS" :key="b.name" class="band pill" :class="{ active: store.multiBands.includes(b.name) }" @click="toggle(b.name)">{{ b.name }}</button>
    </div>
    <div class="bands">
      <span class="sub lim">SWR limit</span>
      <button v-for="l in SWR_LIMITS" :key="l" class="band pill" :class="{ active: store.swrLimit === l }" @click="store.swrLimit = l">{{ l }}</button>
    </div>
    <div class="sub">Select the bands to watch. Each band is swept in turn, so the more bands, the slower the refresh.</div>

    <div v-if="!store.multiBands.length" class="empty">Select at least one band</div>
    <div v-else-if="store.status !== 'connected'" class="empty">Connect to the NanoVNA to measure</div>
    <div class="cards">
      <div v-for="c in cards" :key="c.band.name" class="card" :class="c.cls">
        <div class="head">
          <span class="name">{{ c.band.name }}</span>
          <span v-if="c.measured" class="flag" :class="c.calibrated ? 'is-cal' : ''">{{ c.calibrated ? 'calibrated' : 'not calibrated' }}</span>
          <span v-if="c.min" class="swr">{{ fmt(c.min.swr) }}</span>
        </div>
        <ChartFrame :title="'SWR ' + c.band.name" @change="(s) => fc.onFrame(c.band.name, s)">
        <svg :viewBox="`0 0 ${c.W} ${c.H}`" class="chart" :class="{ full: c.full }">
          <rect :x="c.bandX" :y="T" :width="c.bandW" :height="c.H - T - B" class="band-area" />
          <g v-for="g in grid" :key="g">
            <line :x1="L" :x2="c.W - R" :y1="c.y(g)" :y2="c.y(g)" class="grid" />
            <text :x="L - 3" :y="c.y(g) + 3" class="axis" text-anchor="end">{{ g }}</text>
          </g>
          <rect v-if="c.bw" :x="c.bwX" :y="T" :width="c.bwW" :height="c.H - T - B" class="bw-area" />
          <line :x1="L" :x2="c.W - R" :y1="c.y(store.swrLimit)" :y2="c.y(store.swrLimit)" class="grid2" />
          <path :d="c.path" class="curve" />
          <circle v-if="c.min" :cx="c.minX" :cy="c.y(c.min.swr)" r="3.5" class="min" />
        </svg>
        </ChartFrame>
        <div v-if="!c.measured" class="sub">Waiting for measurement…</div>
        <div v-else class="sub">
          <template v-if="c.min">min at {{ formatFrequency(c.min.freq, 4) }}</template>
          <template v-if="c.bw"> · SWR ≤ {{ store.swrLimit }}: {{ formatFrequency(c.bw.from, 3) }} – {{ formatFrequency(c.bw.to, 3) }}</template>
          <template v-else> · SWR ≤ {{ store.swrLimit }}: none</template>
        </div>
      </div>
    </div>

    <CalPanel />
  </div>
</template>

<style scoped>
.multi { flex: 1; min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 10px; }
.bands { display: flex; flex-wrap: wrap; gap: 6px; }
.band.active { background: var(--primary); color: #fff; border-color: var(--primary); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
.card { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--tile-bg); border-left: 4px solid var(--border-color); }
.card.good { border-left-color: #4caf50; }
.card.warn { border-left-color: #ff9800; }
.card.bad { border-left-color: #f44336; }
.head { display: flex; align-items: baseline; gap: 8px; }
.name { font-size: 16px; font-weight: 500; }
.flag { font-size: 12px; color: #f44336; }
.flag.is-cal { color: #4caf50; }
.swr { margin-left: auto; font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
.chart { display: block; width: 100%; height: auto; }
.chart.full { height: 100%; }
.band-area { fill: var(--band-area); }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.grid2 { stroke: rgba(244, 67, 54, 0.5); stroke-dasharray: 4 3; }
.axis { font-size: 9px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 1.5; }
.min { fill: #f44336; }
.bw-area { fill: rgba(33, 150, 243, 0.2); }
.lim { align-self: center; }
.sub { font-size: 12px; color: var(--text-dim); }
.empty { padding: 16px; text-align: center; color: var(--text-dim); }
</style>
