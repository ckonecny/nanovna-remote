<script setup>
import { computed } from 'vue';
import { appCal } from '../lib/oslcal';

// bands: names of the bands the view is showing
const props = defineProps({ bands: { type: Array, required: true } });

const done = computed(() => props.bands.filter(n => appCal.enabled && appCal.bands[n]).length);
const state = computed(() => (!props.bands.length ? 'none' : done.value === props.bands.length ? 'ok' : done.value ? 'part' : 'none'));
const text = computed(() => {
    if (state.value === 'ok') return props.bands.length > 1 ? `Calibrated (${done.value} of ${props.bands.length} bands)` : 'Calibrated';
    if (state.value === 'part') return `Partly calibrated: ${done.value} of ${props.bands.length} bands`;
    return 'NOT calibrated: values are uncorrected';
});
</script>

<template>
  <div class="cal-status" :class="state"><span class="icon">{{ state === 'ok' ? 'check_circle' : 'warning' }}</span>{{ text }}</div>
</template>

<style scoped>
.cal-status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; border-left: 4px solid; }
.cal-status .icon { font-size: 20px; }
.ok { background: rgba(76, 175, 80, 0.15); border-color: #4caf50; }
.part { background: rgba(255, 152, 0, 0.18); border-color: #ff9800; }
.none { background: rgba(244, 67, 54, 0.15); border-color: #f44336; }
</style>
