<script setup>
// Measurement quality of the NanoVNA itself: IF bandwidth (noise against sweep time), smoothing and output power.
import { ref, onMounted } from 'vue';
import { getWorker, store } from '../store';

defineEmits(['close']);

// the device takes a divider: bandwidth = 4000 Hz / (divider + 1)
const BANDWIDTHS = [
  { hz: 2000, divider: 1 },
  { hz: 1000, divider: 3 },
  { hz: 333, divider: 11 },
  { hz: 100, divider: 39 },
  { hz: 30, divider: 132 },
  { hz: 10, divider: 399 }
];
const POWERS = [
  { value: 255, label: 'Auto' },
  { value: 0, label: 'Lowest (2 mA)' },
  { value: 1, label: 'Low (4 mA)' },
  { value: 2, label: 'High (6 mA)' },
  { value: 3, label: 'Highest (8 mA)' }
];

const loaded = ref(false);
const current = ref({ bandwidth: null, smooth: null, power: null });

onMounted(async () => {
  try {
    current.value = await (await getWorker()).getSweepSettings();
  } finally {
    loaded.value = true;
  }
});

const apply = async (name, value) => {
  current.value[name] = value;
  if (name === 'bandwidth') store.bandwidthHz = 4000 / (value + 1);
  await (await getWorker()).setSweepSetting(name, value);
};
</script>

<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog sweep-dialog">
      <div class="dialog-title">Sweep quality</div>
      <div class="dialog-content">
        <p class="hint" v-if="!loaded">Reading the settings from the NanoVNA...</p>
        <template v-else>
          <label class="row">IF bandwidth
            <select class="field-input" :value="current.bandwidth" @change="apply('bandwidth', +$event.target.value)">
              <option v-if="!BANDWIDTHS.some(b => b.divider === current.bandwidth)" :value="current.bandwidth">
                {{ current.bandwidth === null ? 'unknown' : Math.round(4000 / (current.bandwidth + 1)) + ' Hz' }}
              </option>
              <option v-for="b in BANDWIDTHS" :key="b.divider" :value="b.divider">{{ b.hz }} Hz</option>
            </select>
          </label>
          <p class="hint">A narrower bandwidth lowers the noise and makes every sweep slower: 0.2 s at 1000 Hz, 1 s at 100 Hz, 10 s
            at 10 Hz. Multi, Cable, TDR and the calibration wait accordingly. Calibrate at the bandwidth you measure with.</p>
          <label class="row">Smoothing
            <select class="field-input" :value="current.smooth" @change="apply('smooth', +$event.target.value)">
              <option v-for="n in 9" :key="n" :value="n - 1">{{ n === 1 ? 'Off' : 'Averaging ' + (n - 1) }}</option>
            </select>
          </label>
          <label class="row">Output power
            <select class="field-input" :value="current.power" @change="apply('power', +$event.target.value)">
              <option v-for="p in POWERS" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </label>
          <p class="hint">Applies to the NanoVNA until it is switched off.</p>
        </template>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-primary" @click="$emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sweep-dialog { width: 90%; max-width: 400px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; color: var(--text-main); }
.hint { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); }
</style>
