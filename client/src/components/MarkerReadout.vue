<script setup>
import { computed } from 'vue';
import { store } from '../store';
import * as dsp from '../lib/dsp';
import { nearestIndex, readout, delta, search, eng } from '../lib/marker';

// the channel and value of the first visible trace of the Smith / Freq views
const trace = computed(() => store.traces.find((t) => t.show));
const points = computed(() => (trace.value && trace.value.channel === 1 ? store.data.ch1 : store.data.ch0));

const shown = computed(() => store.markers.filter((m) => m.show));
const rows = computed(() => shown.value.map((m) => {
  const i = nearestIndex(points.value, m.freq);
  return { m, r: i >= 0 ? readout(points.value[i]) : null };
}).filter((x) => x.r));

// the delta marker is the active one; all others are shown relative to it
const ref = computed(() => (store.markerDelta ? rows.value.find((x) => x.m.id === store.activeMarkerId) || rows.value[0] : null));
const d = (x) => (ref.value && x !== ref.value ? delta(ref.value.r, x.r) : null);

const f = (v, digits, unit = '') => (v === null || !Number.isFinite(v) ? (v === Infinity ? '∞' : '-') : v.toFixed(digits) + unit);
const sgn = (v, digits, unit = '') => (v === null ? '-' : (v >= 0 ? '+' : '') + v.toFixed(digits) + unit);
const reactive = (r) => (r.ls !== null ? eng(r.ls, 'H') : r.cs !== null ? eng(r.cs, 'F') : '-');
const parallel = (r) => eng(r.rp, 'Ω') + ' ‖ ' + (r.lp !== null ? eng(r.lp, 'H') : r.cp !== null ? eng(r.cp, 'F') : '-');

// value of the trace at a point; smith, ysmith and polar are ordered like |Γ|
const valueOf = (t) => {
  if (!t) return () => NaN;
  const format = dsp.SMITH_FORMATS.includes(t.format) ? 'linear' : t.format;
  const values = new Map();
  const pts = points.value;
  dsp.traceValues(pts, format).forEach((v, i) => values.set(pts[i], v));
  return (p) => values.get(p);
};

const active = () => store.markers.find((m) => m.id === store.activeMarkerId) || shown.value[0];
const find = (kind) => {
  const m = active();
  const fr = search(points.value, valueOf(trace.value), kind);
  if (m && fr !== null) { m.freq = fr; store.activeMarkerId = m.id; }
};

// frequency range from the markers: start/stop from the lowest and highest shown marker, centre from the active one
const setRange = (what) => {
  const fs = shown.value.map((m) => m.freq);
  const fr = store.frequencies;
  if (what === 'start' && active()) fr.start = active().freq;
  else if (what === 'stop' && active()) fr.stop = active().freq;
  else if (what === 'center' && active()) { fr.center = active().freq; fr.start = fr.center - fr.span / 2; fr.stop = fr.center + fr.span / 2; return; }
  else if (what === 'span' && fs.length > 1) { fr.start = Math.min(...fs); fr.stop = Math.max(...fs); }
  else return;
  fr.center = (fr.start + fr.stop) / 2;
  fr.span = Math.abs(fr.stop - fr.start);
};
</script>

<template>
  <div class="marker-readout" v-if="rows.length">
    <div class="mr-tools">
      <label class="mr-delta"><input type="checkbox" v-model="store.markerDelta" /> Delta</label>
      <button class="btn mr-btn" @click="find('min')" title="Move the active marker to the minimum of the first trace">Min</button>
      <button class="btn mr-btn" @click="find('max')" title="Move the active marker to the maximum of the first trace">Max</button>
      <span class="mr-sep"></span>
      <span class="mr-cap">Sweep range from marker:</span>
      <button class="btn mr-btn" @click="setRange('start')">→ Start</button>
      <button class="btn mr-btn" @click="setRange('stop')">→ Stop</button>
      <button class="btn mr-btn" @click="setRange('center')">→ Center</button>
      <button class="btn mr-btn" @click="setRange('span')" :disabled="rows.length < 2">→ Span</button>
    </div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th v-for="x in rows" :key="x.m.id" :class="{ act: x.m.id === store.activeMarkerId }" @click="store.activeMarkerId = x.m.id">
            {{ dsp.formatFrequency(x.r.freq, 3) }}<span v-if="x === ref"> Δ</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Z</td><td v-for="x in rows" :key="x.m.id">{{ d(x) ? sgn(d(x).r, 1) + ' ' + sgn(d(x).x, 1) + 'j' : f(x.r.r, 1) + (x.r.x < 0 ? ' − ' : ' + ') + f(Math.abs(x.r.x), 1) + 'j' }}</td></tr>
        <tr><td>SWR</td><td v-for="x in rows" :key="x.m.id">{{ d(x) ? sgn(d(x).swr, 2) : f(x.r.swr, 2) }}</td></tr>
        <tr><td>RL</td><td v-for="x in rows" :key="x.m.id">{{ d(x) ? sgn(d(x).rl, 1, ' dB') : f(x.r.rl, 1, ' dB') }}</td></tr>
        <tr><td>Phase</td><td v-for="x in rows" :key="x.m.id">{{ d(x) ? sgn(d(x).phase, 1, '°') : f(x.r.phase, 1, '°') }}</td></tr>
        <tr><td>Q</td><td v-for="x in rows" :key="x.m.id">{{ f(x.r.q, 2) }}</td></tr>
        <tr><td>Series</td><td v-for="x in rows" :key="x.m.id">{{ f(x.r.r, 1) }} Ω + {{ reactive(x.r) }}</td></tr>
        <tr><td>Parallel</td><td v-for="x in rows" :key="x.m.id">{{ parallel(x.r) }}</td></tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.marker-readout { flex: none; overflow-x: auto; padding: 4px 8px; font-size: 12px; border-top: 1px solid var(--divider); }
.mr-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; padding: 2px 0 4px; }
.mr-delta { display: flex; align-items: center; gap: 4px; }
.mr-sep { flex: 1; }
.mr-cap { color: var(--text-dim); }
.mr-btn { padding: 2px 8px; min-height: 0; font-size: 12px; }
table { border-collapse: collapse; font-family: monospace; }
td:first-child, th:first-child { padding-right: 16px; }
th, td { text-align: right; padding: 1px 6px; white-space: nowrap; }
td:first-child, th:first-child { text-align: left; color: var(--text-dim); }
th { cursor: pointer; }
th.act { color: var(--primary); }
</style>
