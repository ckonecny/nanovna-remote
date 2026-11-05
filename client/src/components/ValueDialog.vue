<script setup>
// How values are shown in the HAM, Multi, Freq and marker views (kept in the browser).
import { store } from '../store';

defineEmits(['close']);
</script>

<template>
  <div class="dialog-overlay" @click.self="$emit('close')">
    <div class="dialog sweep-dialog">
      <div class="dialog-title">Value display</div>
      <div class="dialog-content">
        <label class="row">Impedance
          <select class="field-input" v-model="store.zFormat">
            <option value="rx">R + jX</option>
            <option value="polar">|Z| and angle</option>
          </select>
        </label>
        <label class="row">Match, main value
          <select class="field-input" v-model="store.matchMain">
            <option value="swr">SWR</option>
            <option value="rl">Return loss</option>
          </select>
        </label>
        <p class="hint">The other values stay available in the cursor readout and in the Freq tiles. Chart axes do not change.</p>
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
