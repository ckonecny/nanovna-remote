<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store';
import { CABLE_RANGES, CABLE_TYPES, analyseCable, analyseImpedance, stubLength, wavelength } from '../lib/cable';
import { formatFrequency } from '../lib/dsp';

const mode = ref('length'); // 'length': velocity factor known, 'vf': length known

const L = 52, R = 12, T = 12, B = 28;
const W = ref(600), H = 220;
const wrap = ref(null);
let observer = null;
const resize = () => { if (wrap.value) W.value = Math.max(280, Math.round(wrap.value.clientWidth) - 24); };
onMounted(() => { resize(); observer = new ResizeObserver(resize); observer.observe(wrap.value); });
onUnmounted(() => { if (observer) observer.disconnect(); });

const result = computed(() => {
    store.dataVersion; // recompute on every sweep
    return analyseCable(store.cable.points, { vf: store.velocityFactor, length: mode.value === 'vf' ? store.cableLength : 0, zero: zero.value });
});

// the device's own delay, measured with nothing attached; it belongs to the sweep it was measured with
const zero = computed(() => store.cableZero[store.cablePreset] || 0);
const rawDelay = computed(() => { store.dataVersion; const r = analyseCable(store.cable.points, { vf: 1, length: 0 }); return r && r.valid ? r.delay : null; });
const setZero = () => { if (rawDelay.value !== null) store.cableZero[store.cablePreset] = rawDelay.value; };
const clearZero = () => { delete store.cableZero[store.cablePreset]; };

// unwrapped phase (turns) over frequency with the fitted line
const chart = computed(() => {
    const r = result.value, pts = store.cable.points;
    if (!r) return null;
    const used = pts.map((p, i) => ({ f: p.freq, ph: r.phases[i] })).filter(p => p.ph !== null);
    if (!used.length) return null;
    const f0 = used[0].f, f1 = used[used.length - 1].f;
    const turns = (rad) => rad / (2 * Math.PI);
    const vals = used.map(p => turns(p.ph));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    const x = (f) => L + (f - f0) / (f1 - f0 || 1) * (W.value - L - R);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const line = (get) => used.map((p, i) => (i ? 'L' : 'M') + x(p.f).toFixed(1) + ' ' + y(get(p)).toFixed(1)).join(' ');
    return {
        data: line(p => turns(p.ph)),
        fit: line(p => turns(r.fit.a + r.fit.slope * p.f)),
        yticks: [0, 0.5, 1].map(t => ({ y: y(lo + t * (hi - lo)), label: (lo + t * (hi - lo)).toFixed(1) })),
        xticks: [0, 0.5, 1].map(t => ({ x: x(f0 + t * (f1 - f0)), label: (f0 + t * (f1 - f0)) / 1e6 })),
    };
});

// one-way loss at a few frequencies
const lossRows = computed(() => {
    const r = result.value;
    if (!r || !r.loss.length) return [];
    const len = mode.value === 'vf' ? store.cableLength : r.length;
    // a few cm of adapter say nothing about dB per 100 m, so that figure needs at least 1 m
    return [0.25, 0.5, 1].map((t) => {
        const p = r.loss[Math.min(r.loss.length - 1, Math.round(t * (r.loss.length - 1)))];
        return { freq: p.freq, db: p.db, per100: len >= 1 ? p.db / len * 100 : null };
    });
});

// characteristic impedance: one sweep with the far end open and one shorted, both of the same sweep
const snapshot = () => store.cable.points.map(p => ({ freq: p.freq, real: p.real, imag: p.imag }));
const openSweep = ref(null), shortSweep = ref(null);
const keep = (end) => {
    const pts = snapshot();
    if (!pts.length) return;
    const other = end === 'open' ? shortSweep : openSweep;
    if (other.value && other.value.preset !== store.cablePreset) other.value = null; // sweeps of different ranges cannot be combined
    (end === 'open' ? openSweep : shortSweep).value = { preset: store.cablePreset, points: pts };
};
const clearImpedance = () => { openSweep.value = null; shortSweep.value = null; };
const impedance = computed(() => (openSweep.value && shortSweep.value ? analyseImpedance(openSweep.value.points, shortSweep.value.points) : null));

// stub and cut lengths
const stub = ref({ freqMHz: 14.2, x: 100, z0: 50 });
const stubFreq = computed(() => stub.value.freqMHz * 1e6);
const stubOk = computed(() => stubFreq.value > 0 && store.velocityFactor > 0 && stub.value.z0 > 0 && isFinite(stub.value.x));
const stubs = computed(() => {
    if (!stubOk.value) return null;
    const a = { freq: stubFreq.value, vf: store.velocityFactor, x: stub.value.x, z0: stub.value.z0 };
    return {
        quarter: wavelength(a.freq, a.vf) / 4, half: wavelength(a.freq, a.vf) / 2,
        short: stubLength({ ...a, type: 'short' }), open: stubLength({ ...a, type: 'open' }),
    };
});
const useMeasuredZ0 = () => { if (impedance.value) stub.value.z0 = Math.round(impedance.value.z0 * 10) / 10; };

const pickType = (e) => {
    const t = CABLE_TYPES.find(c => c.name === e.target.value);
    if (t) store.velocityFactor = t.vf;
    e.target.value = '';
};
const range = computed(() => CABLE_RANGES[store.cablePreset]);
const fmt = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '–');
</script>

<template>
  <div class="cable" ref="wrap">
    <div class="how">Connect the cable to the NanoVNA and leave its far end <b>open</b> or <b>shorted</b> (nothing else attached). The length follows from how fast the reflection's phase turns with frequency.</div>

    <div class="row">
      <label>Sweep
        <select v-model="store.cablePreset" class="input field-input">
          <option v-for="(r, k) in CABLE_RANGES" :key="k" :value="k">{{ r.label }}</option>
        </select>
      </label>
      <label>Measure
        <select v-model="mode" class="input field-input">
          <option value="length">Length (velocity factor known)</option>
          <option value="vf">Velocity factor (length known)</option>
        </select>
      </label>
    </div>
    <div class="row">
      <label v-if="mode === 'length'">Velocity factor
        <input type="number" v-model.number="store.velocityFactor" class="input field-input" step="0.01" min="0.1" max="1">
      </label>
      <label v-if="mode === 'length'">Cable type
        <select class="input field-input" @change="pickType" :value="''">
          <option value="">typical values…</option>
          <option v-for="t in CABLE_TYPES" :key="t.name" :value="t.name">{{ t.name }} ({{ t.vf }})</option>
        </select>
      </label>
      <label v-else>Known length (m)
        <input type="number" v-model.number="store.cableLength" class="input field-input" step="0.1" min="0.1">
      </label>
    </div>

    <div class="zero">
      <button class="btn-small pill" :disabled="rawDelay === null" @click="setZero">Zero: nothing attached</button>
      <button class="btn-small pill" :disabled="!zero" @click="clearZero">Clear zero</button>
      <span class="sub">{{ zero ? 'Zero set: ' + fmt(zero * 1e9, 2) + ' ns subtracted' : 'No zero set: the NanoVNA\'s own delay (about 2 ns) is included. Remove the cable and press Zero.' }}</span>
    </div>

    <div v-if="!result" class="empty">{{ store.status === 'connected' ? 'Waiting for measurement…' : 'Connect to the NanoVNA to measure' }}</div>
    <template v-else>
      <div v-if="!result.valid" class="warn">No usable phase slope. Check that the far end is open or shorted and that the cable is connected.</div>
      <div v-else class="tiles">
        <div class="tile" v-if="mode === 'length'"><span class="label">Length</span><span class="value">{{ fmt(result.length) }} m</span><span class="sub">at velocity factor {{ fmt(store.velocityFactor) }}</span></div>
        <div class="tile" v-else><span class="label">Velocity factor</span><span class="value">{{ fmt(result.vf, 3) }}</span><span class="sub">for {{ fmt(store.cableLength, 1) }} m</span></div>
        <div class="tile"><span class="label">One-way delay</span><span class="value">{{ fmt(result.delay * 1e9, 1) }} ns</span></div>
        <div class="tile" :class="{ bad: !result.good }"><span class="label">Fit</span><span class="value small">{{ result.good ? 'phase is a straight line' : 'not a straight line' }}</span><span class="sub">{{ result.good ? 'result is plausible' : 'cable not open/short, or not connected' }}</span></div>
      </div>

      <svg v-if="chart" :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" class="chart">
        <g v-for="t in chart.yticks" :key="t.label">
          <line :x1="L" :x2="W - R" :y1="t.y" :y2="t.y" class="grid" />
          <text :x="L - 6" :y="t.y + 4" class="axis" text-anchor="end">{{ t.label }}</text>
        </g>
        <text v-for="t in chart.xticks" :key="t.label" :x="t.x" :y="H - 8" class="axis" text-anchor="middle">{{ t.label }}</text>
        <path :d="chart.fit" class="fit" />
        <path :d="chart.data" class="curve" />
      </svg>
      <div class="sub">Unwrapped reflection phase in turns over frequency in MHz, with the fitted line (dashed).</div>

      <div v-if="lossRows.length" class="loss">
        <span class="label">Loss of the cable (one way)</span>
        <div v-for="r in lossRows" :key="r.freq" class="loss-row">
          <span>{{ formatFrequency(r.freq, 3) }}</span><span>{{ fmt(r.db) }} dB</span><span v-if="r.per100 !== null">{{ fmt(r.per100, 1) }} dB / 100 m</span>
        </div>
      </div>
    </template>

    <div class="section">
      <span class="label">Characteristic impedance</span>
      <div class="sub">Measure the same cable twice with the same sweep: once with the far end open, once shorted. Both sweeps are kept until cleared.</div>
      <div class="zero">
        <button class="btn-small pill" :disabled="!result" @click="keep('open')">Measure open</button>
        <button class="btn-small pill" :disabled="!result" @click="keep('short')">Measure short</button>
        <button class="btn-small pill" :disabled="!openSweep && !shortSweep" @click="clearImpedance">Clear</button>
        <span class="sub">Open: {{ openSweep ? 'measured' : '–' }} · Short: {{ shortSweep ? 'measured' : '–' }}</span>
      </div>
      <div v-if="impedance" class="tiles">
        <div class="tile"><span class="label">Impedance</span><span class="value">{{ fmt(impedance.z0, 1) }} Ω</span><span class="sub">median of {{ impedance.n }} points, spread ±{{ fmt(impedance.spread, 1) }} Ω</span></div>
      </div>
      <div v-else-if="openSweep && shortSweep" class="warn">No usable result. The cable is too short for this sweep (try 1 – 200 MHz) or the two sweeps do not belong together.</div>
      <div class="sub">The value is only as good as the NanoVNA's own calibration for this sweep.</div>
    </div>

    <div class="section">
      <span class="label">Cut and stub lengths</span>
      <div class="row">
        <label>Frequency (MHz)<input type="number" v-model.number="stub.freqMHz" class="input field-input" step="0.1" min="0.1"></label>
        <label>Reactance to produce (Ω, negative: capacitive)<input type="number" v-model.number="stub.x" class="input field-input" step="1"></label>
        <label>Cable impedance (Ω)<input type="number" v-model.number="stub.z0" class="input field-input" step="1" min="1"></label>
      </div>
      <div class="zero"><button class="btn-small pill" :disabled="!impedance" @click="useMeasuredZ0">Use measured impedance</button><span class="sub">Uses the velocity factor above ({{ fmt(store.velocityFactor) }}).</span></div>
      <div v-if="stubs" class="tiles">
        <div class="tile"><span class="label">λ/4</span><span class="value">{{ fmt(stubs.quarter) }} m</span></div>
        <div class="tile"><span class="label">λ/2</span><span class="value">{{ fmt(stubs.half) }} m</span></div>
        <div class="tile"><span class="label">Shorted stub</span><span class="value">{{ fmt(stubs.short) }} m</span><span class="sub">shortest length with this reactance</span></div>
        <div class="tile"><span class="label">Open stub</span><span class="value">{{ fmt(stubs.open) }} m</span><span class="sub">shortest length with this reactance</span></div>
      </div>
      <div class="sub">Lengths are of the cable itself, cut from the connector's reference plane to the end; add the length of a T piece or connector as needed.</div>
    </div>

    <div class="sub">Accuracy: set the zero with the port open and no adapter; an adapter between port and cable adds about 1 cm. The NanoVNA's calibration state is not touched. The sweep must not turn the phase by more than half a revolution between two points, so a cable longer than the sweep's limit ({{ range.maxLength }} m) shows a wrong, shorter length.</div>
  </div>
</template>

<style scoped>
.cable { flex: 1; min-width: 0; padding: 8px 12px; display: flex; flex-direction: column; gap: 10px; }
.how { font-size: 14px; }
.row { display: flex; flex-wrap: wrap; gap: 12px; }
.row label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--text-dim); flex: 1; min-width: 180px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
.tile { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.tile.bad { border-left: 4px solid #f44336; }
.label { font-size: 12px; color: var(--text-dim); }
.value { font-size: 24px; font-weight: 500; font-variant-numeric: tabular-nums; }
.value.small { font-size: 16px; }
.sub { font-size: 12px; color: var(--text-dim); }
.zero { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.warn { padding: 8px 12px; border-radius: 8px; background: var(--notice-bg); font-size: 14px; }
.chart { display: block; max-width: 100%; }
.grid { stroke: var(--swr-grid); stroke-width: 1; }
.axis { font-size: 12px; fill: var(--text-dim); }
.curve { fill: none; stroke: var(--curve); stroke-width: 2; }
.fit { fill: none; stroke: #f44336; stroke-width: 1.5; stroke-dasharray: 5 4; }
.loss { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.loss-row { display: flex; gap: 16px; font-variant-numeric: tabular-nums; }
.loss-row span { min-width: 90px; }
.section { display: flex; flex-direction: column; gap: 8px; padding-top: 6px; border-top: 1px solid var(--border-color); }
.empty { padding: 16px; text-align: center; color: var(--text-dim); }
</style>
