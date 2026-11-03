<script setup>
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

// Wraps a chart with a button that lets it fill the whole screen and go back. The frame only moves its box over the window
// (position: fixed), so the chart keeps its state and its own handlers (cursor, zoom, pan). A chart drawn at a pixel size
// gets the size of the box through `change` ({ full, w, h }).
defineProps({ title: { type: String, default: '' } });
const emit = defineEmits(['change']);

const full = ref(false);
const root = ref(null);
const body = ref(null);
let observer = null;
let native = false; // the browser's own full screen is on as well (not on an iPhone)

const report = () => {
    if (!body.value) return;
    emit('change', { full: full.value, w: Math.round(body.value.clientWidth), h: Math.round(body.value.clientHeight) });
};

// Leaving full screen while the browser is still entering it: exit as soon as it has entered
let pendingExit = false;
const leaveNative = () => {
    native = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    else pendingExit = true;
};

const set = (on) => {
    if (full.value === on) return;
    full.value = on;
    if (on) {
        pendingExit = false;
        if (root.value && root.value.requestFullscreen) {
            native = true;
            root.value.requestFullscreen().then(() => { if (pendingExit) { pendingExit = false; document.exitFullscreen().catch(() => { }); } }, () => { native = false; });
        }
    } else if (native) leaveNative();
    nextTick(report); // the box has moved once Vue has applied the class; the observer follows later changes
};

const onKey = (e) => { if (e.key === 'Escape' && full.value) set(false); };
const onFullscreenChange = () => { if (native && !document.fullscreenElement) { native = false; set(false); } };

onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => { if (full.value) report(); });
        observer.observe(body.value);
    }
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreenChange);
});
onUnmounted(() => {
    observer?.disconnect();
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (full.value) { // the view goes away while the chart is full
        full.value = false;
        if (native) leaveNative();
        emit('change', { full: false, w: 0, h: 0 });
    }
});
</script>

<template>
  <div ref="root" class="chart-frame" :class="{ full }">
    <div v-if="full" class="fs-title">{{ title }}</div>
    <button class="fs-btn" type="button" :title="full ? 'Back to the normal view' : 'Chart full screen'" :aria-label="full ? 'Exit full screen' : 'Chart full screen'" @click="set(!full)">
      <!-- drawn inline: the icon font comes from Google and is missing without internet -->
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path v-if="full" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
        <path v-else d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
      </svg>
    </button>
    <div ref="body" class="chart-body"><slot /></div>
  </div>
</template>

<style scoped>
.chart-frame { position: relative; width: 100%; height: 100%; min-width: 0; }
.chart-body { width: 100%; height: 100%; min-width: 0; }
.fs-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  z-index: 2;
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--divider);
  border-radius: 50%;
  background: var(--tile-bg);
  color: var(--text-dim);
  opacity: 0.85;
  cursor: pointer;
}
.fs-btn:hover { opacity: 1; color: var(--text-main); }
.chart-frame.full {
  position: fixed;
  inset: 0;
  z-index: 200;
  width: auto;
  height: auto;
  display: flex;
  flex-direction: column;
  background: var(--surface-color);
  padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
  overscroll-behavior: contain;
}
.chart-frame.full .fs-btn { top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); }
/* A phone: the page may reach under the camera cut-out and the rounded corners without reporting a safe area (no viewport-fit).
   The chart uses the whole width; only the title and the button, which sit in the rounded top corners, move in. In portrait the
   cut-out is at the top, so everything starts lower. */
@media (hover: none) and (pointer: coarse) {
  .chart-frame.full .fs-btn { top: max(18px, env(safe-area-inset-top)); right: max(24px, env(safe-area-inset-right)); }
  .chart-frame.full .fs-title { padding-left: 28px; padding-right: 56px; padding-top: 6px; }
}
@media (hover: none) and (pointer: coarse) and (orientation: portrait) {
  .chart-frame.full { padding-top: max(56px, env(safe-area-inset-top)); }
  .chart-frame.full .fs-btn { top: max(56px, env(safe-area-inset-top)); }
  .chart-frame.full .fs-title { padding-left: 0; padding-top: 0; }
}
</style>
