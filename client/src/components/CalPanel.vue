<script setup>
import { computed } from 'vue';
import { store, calRun, CAL_STEPS, appCalMeasure, appCalReset, appCalStart, appCalBack, appCalClose, appCalAccept, appCalDiscard } from '../store';
import { appCal } from '../lib/oslcal';
import { HAM_BANDS } from '../lib/bands';

const calibratedBands = computed(() => Object.keys(appCal.bands).length);
const info = {
  open: { name: 'Open', text: 'Attach the OPEN standard to the connector, or leave the connector open with nothing attached.' },
  short: { name: 'Short', text: 'Attach the SHORT standard to the connector.' },
  load: { name: 'Load', text: 'Attach the 50 Ω LOAD standard to the connector.' },
};
const finished = computed(() => calRun.next >= CAL_STEPS.length);
const current = computed(() => info[CAL_STEPS[calRun.next]]);
const state = (i) => (i < calRun.next ? 'done' : i === calRun.next ? 'now' : 'todo');
const resetCal = () => { if (confirm('Delete the calibration of all bands?')) appCalReset(); };
</script>

<template>
  <div class="cal">
    <span class="label">Calibration ({{ calibratedBands }} of {{ HAM_BANDS.length }} bands)</span>

    <template v-if="!calRun.guided">
      <div class="cal-steps">
        <button class="band pill" :disabled="calRun.running || store.status !== 'connected'" @click="appCalStart">Calibrate...</button>
        <button class="band pill" :disabled="calRun.running" @click="resetCal">Reset</button>
      </div>
      <div class="sub">Guided open, short and load calibration of all bands. Have the three standards at hand.</div>
    </template>

    <template v-else>
      <ol class="cal-progress">
        <li v-for="(id, i) in CAL_STEPS" :key="id" :class="state(i)">{{ info[id].name }}<span v-if="state(i) === 'done'"> ✓</span></li>
      </ol>

      <template v-if="finished">
        <div class="sub">Calibration complete: {{ calibratedBands }} of {{ HAM_BANDS.length }} bands.</div>
        <div class="cal-steps"><button class="band pill" @click="appCalClose">Done</button></div>
      </template>

      <template v-else>
        <div class="cal-now"><strong>Step {{ calRun.next + 1 }} of {{ CAL_STEPS.length }}: {{ current.name }}.</strong> {{ current.text }}</div>

        <div v-if="calRun.suspect" class="cal-suspect">
          <div>{{ calRun.suspect.problem }}</div>
          <div class="cal-steps">
            <button class="band pill" @click="appCalDiscard">Measure again</button>
            <button class="band pill" @click="appCalAccept">Use anyway</button>
          </div>
        </div>
        <div v-else class="cal-steps">
          <button class="band pill" :disabled="calRun.running || store.status !== 'connected'" @click="appCalMeasure(CAL_STEPS[calRun.next])">Measure {{ current.name }}</button>
          <button class="band pill" :disabled="calRun.running || calRun.next === 0" @click="appCalBack">Back</button>
          <button class="band pill" :disabled="calRun.running" @click="appCalClose">Cancel</button>
        </div>
        <div v-if="calRun.running" class="sub">Measuring {{ calRun.step }}: {{ calRun.band }} ({{ calRun.done }} of {{ calRun.total }})</div>
      </template>
    </template>

    <div v-if="calRun.error" class="sub err">{{ calRun.error }}</div>
  </div>
</template>

<style scoped>
.cal { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 8px; background: var(--tile-bg); }
.cal-steps { display: flex; flex-wrap: wrap; gap: 6px; }
.cal-progress { display: flex; gap: 6px; margin: 0; padding: 0; list-style: none; }
.cal-progress li { padding: 2px 10px; border-radius: 12px; font-size: 12px; color: var(--text-dim); border: 1px solid var(--divider); }
.cal-progress li.now { color: var(--primary); border-color: var(--primary); font-weight: 600; }
.cal-progress li.done { color: var(--text); }
.cal-now { font-size: 13px; }
.cal-suspect { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 6px; border: 1px solid #f57c00; font-size: 13px; }
.label { font-size: 12px; color: var(--text-dim); }
.sub { font-size: 12px; color: var(--text-dim); }
.err { color: #f44336; }
</style>
