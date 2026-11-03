<script setup>
import { computed } from 'vue';
import { store } from '../store';
import { HAM_BANDS } from '../lib/bands';
import CalStatus from './CalStatus.vue';
import CalPanel from './CalPanel.vue';
import { calcSWR, formatFrequency } from '../lib/dsp';

const SWR_MAX = 5;
const W = 300, H = 110, L = 22, R = 6, T = 6, B = 6;

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
        const min = inBand.length ? inBand.reduce((a, p) => p.swr < a.swr ? p : a) : null;
        let best = null, cur = null;
        for (const p of inBand) {
            if (p.swr <= 2) {
                cur = cur ? { from: cur.from, to: p.freq } : { from: p.freq, to: p.freq };
                if (!best || cur.to - cur.from > best.to - best.from) best = { ...cur };
            } else cur = null;
        }
        const f0 = points.length ? points[0].freq : band.start, f1 = points.length ? points[points.length - 1].freq : band.stop;
        const x = (f) => L + (f - f0) / (f1 - f0 || 1) * (W - L - R);
        const y = (swr) => T + (1 - (Math.min(swr, SWR_MAX) - 1) / (SWR_MAX - 1)) * (H - T - B);
        return {
            band, points, min, swr2: best, calibrated: m ? m.calibrated : false, measured: !!m,
            path: points.map((p, i) => (i ? 'L' : 'M') + x(p.freq).toFixed(1) + ' ' + y(p.swr).toFixed(1)).join(' '),
            bandX: x(band.start), bandW: Math.max(0, x(band.stop) - x(band.start)),
            y,
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
        <svg :viewBox="`0 0 ${W} ${H}`" class="chart">
          <rect :x="c.bandX" :y="T" :width="c.bandW" :height="H - T - B" class="band-area" />
          <g v-for="g in grid" :key="g">
            <line :x1="L" :x2="W - R" :y1="c.y(g)" :y2="c.y(g)" :class="['grid', g === 2 && 'grid2']" />
            <text :x="L - 3" :y="c.y(g) + 3" class="axis" text-anchor="end">{{ g }}</text>
          </g>
          <path :d="c.path" class="curve" />
          <circle v-if="c.min" :cx="c.minX" :cy="c.y(c.min.swr)" r="3.5" class="min" />
        </svg>
        <div v-if="!c.measured" class="sub">Waiting for measurement…</div>
        <div v-else class="sub">
          <template v-if="c.min">min at {{ formatFrequency(c.min.freq, 4) }}</template>
          <template v-if="c.swr2"> · SWR ≤ 2: {{ formatFrequency(c.swr2.from, 3) }} – {{ formatFrequency(c.swr2.to, 3) }}</template>
          <template v-else> · SWR ≤ 2: none in band</template>
        </div>
      </div>
    </div>

    <CalPanel />
  </div>
</template>

<style scoped>
.multi { flex: 1; min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 10px; }
.bands { display: flex; flex-wrap: wrap; gap: 6px; }
.band.active { background: #3f51b5; color: #fff; border-color: #3f51b5; }
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
.band-area { fill: var(--band-area); }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.grid2 { stroke: rgba(244, 67, 54, 0.5); stroke-dasharray: 4 3; }
.axis { font-size: 9px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 1.5; }
.min { fill: #f44336; }
.sub { font-size: 12px; color: var(--text-dim); }
.empty { padding: 16px; text-align: center; color: var(--text-dim); }
</style>
