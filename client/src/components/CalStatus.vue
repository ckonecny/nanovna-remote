<script setup>
import { computed } from 'vue';
import { calState } from '../lib/calstate';

// bands: names of the bands the view is showing.
// A warning only: it appears when a band is missing its calibration. Calibrated is shown by the green header of the
// Calibration section of the view, and with no band selected there is nothing to say.
const props = defineProps({ bands: { type: Array, required: true } });
const st = computed(() => calState(props.bands));
</script>

<template>
  <div v-if="bands.length && st.state !== 'ok'" class="cal-status" :class="st.state"><span class="icon">warning</span>{{ st.text }}</div>
</template>

<style scoped>
.cal-status { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; border-left: 4px solid; background: rgba(255, 152, 0, 0.18); border-color: #ff9800; }
.cal-status .icon { font-size: 20px; }
</style>
