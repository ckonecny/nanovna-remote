<script setup>
// Demo build only: says that the values are simulated and chooses what is "connected" to the simulated NanoVNA.
import { ref, onUnmounted } from 'vue';
import { DUTS, DEMO_CHANNEL } from '../lib/demo';

const dut = ref('antenna');
const channel = new BroadcastChannel(DEMO_CHANNEL);
const send = () => channel.postMessage({ dut: dut.value });
// a simulated NanoVNA that starts later asks for the choice made so far
channel.onmessage = (e) => { if (e.data && e.data.hello) send(); };
onUnmounted(() => channel.close());
</script>

<template>
  <div class="demo">
    <span class="note"><b>Demo</b> &ndash; simulated values, no real measurement. Connected to the simulated NanoVNA:</span>
    <select v-model="dut" @change="send" aria-label="What is connected to the simulated NanoVNA">
      <option v-for="[id, label] in DUTS" :key="id" :value="id">{{ label }}</option>
    </select>
  </div>
</template>

<style scoped>
.demo { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 6px 16px; font-size: 13px; background: var(--tile-bg); border-bottom: 1px solid var(--border-color); color: var(--text-main); }
.note { flex: 1 1 280px; }
select { flex: 0 1 auto; max-width: 100%; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--surface-color); color: var(--text-main); font-size: 13px; }
</style>
