<script setup>
import { computed } from 'vue';
import { store, calRun, appCalMeasure, appCalReset } from '../store';
import { appCal } from '../lib/oslcal';
import { HAM_BANDS } from '../lib/bands';

const calibratedBands = computed(() => Object.keys(appCal.bands).length);
const pending = (step) => HAM_BANDS.filter(b => appCal.raw[b.name]?.[step]).length;
const steps = [['open', 'Open'], ['short', 'Short'], ['load', 'Load']];
const resetCal = () => { if (confirm('Delete the calibration of all bands?')) appCalReset(); };
</script>

<template>
  <div class="cal">
    <span class="label">Calibration ({{ calibratedBands }} of {{ HAM_BANDS.length }} bands)</span>
    <div class="cal-steps">
      <button v-for="[id, name] in steps" :key="id" class="band pill" :disabled="calRun.running || store.status !== 'connected'" @click="appCalMeasure(id)">
        Measure {{ name }}<span v-if="pending(id)"> ✓</span>
      </button>
      <button class="band pill" :disabled="calRun.running" @click="resetCal">Reset</button>
    </div>
    <div class="sub">Connect the standard to the NanoVNA, then press its button. All bands are measured in one go.</div>
    <div v-if="calRun.running" class="sub">Measuring {{ calRun.step }}: {{ calRun.band }} ({{ calRun.done }} of {{ calRun.total }})</div>
    <div v-if="calRun.error" class="sub err">{{ calRun.error }}</div>
  </div>
</template>

<style scoped>
.cal { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.cal-steps { display: flex; flex-wrap: wrap; gap: 6px; }
.label { font-size: 12px; color: var(--text-dim); }
.sub { font-size: 12px; color: var(--text-dim); }
.err { color: #f44336; }
</style>
