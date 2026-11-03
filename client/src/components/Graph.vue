<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import Chart from 'chart.js';
import 'chartjs-chart-smith';
import { store, getWorker } from '../store';
import ChartFrame from './ChartFrame.vue';
import * as dsp from '../lib/dsp';
import { transformRange, clampRange, pinchFactor } from '../lib/zoom';

// with several traces the default tooltip position is the mean of all points, which floats between the curves:
// anchor it on the first trace's point instead
if (Chart.Tooltip && Chart.Tooltip.positioners) {
  Chart.Tooltip.positioners.firstPoint = (elements) => (elements.length ? { x: elements[0]._model.x, y: elements[0]._model.y } : false);
}

// Register Chart.js plugin for pinned tooltips (markers)
Chart.pluginService.register({
  beforeRender: function (chart) {
    if (chart.config.options.pinnedTooltips && chart.config.options.pinnedTooltips.length > 0) {
      // Create array of tooltips for markers
      chart.pluginTooltips = [];

      const indexes = chart.config.options.pinnedTooltips.map((freq) => {
        return chart.data.labels.findIndex((f) => f >= freq);
      }).filter(i => i >= 0);

      for (let target of indexes) {
        const active = chart.config.data.datasets.map((_, i) => {
          const meta = chart.getDatasetMeta(i);
          return meta && meta.data && meta.data[target];
        }).filter(Boolean);

        if (active.length > 0 && active[0]) {
          chart.pluginTooltips.push(new Chart.Tooltip({
            _chart: chart.chart,
            _chartInstance: chart,
            _data: chart.data,
            _options: chart.options.tooltips,
            _active: active,
          }, chart));
        }
      }
    }
  },
  afterDraw: function (chart, easing) {
    if (chart.config.options.pinnedTooltips && chart.config.options.pinnedTooltips.length > 0) {
      if (!chart.allTooltipsOnce) {
        if (easing !== 1) return;
        chart.allTooltipsOnce = true;
      }

      Chart.helpers.each(chart.pluginTooltips, function (tooltip) {
        tooltip.initialize();
        tooltip.update();
        tooltip.pivot();
        tooltip.transition(easing).draw();
      });
    }
  }
});


const props = defineProps({
  type: { type: String, default: 'frequency' } // 'frequency' or 'smith'
});

// the Smith view draws the polar formats on a plain Γ plane when no Smith trace is shown
const smithTraces = () => store.traces.filter(t => t.show && dsp.SMITH_FORMATS.includes(t.format));
const kind = () => (props.type === 'smith' && smithTraces().length && smithTraces().every(t => t.format === 'polar') ? 'polar' : props.type);
let chartKind = kind();

// chart.js draws on a canvas, so the theme colours have to be handed to it
const colors = () => {
  const cs = getComputedStyle(document.documentElement);
  const get = (n) => cs.getPropertyValue(n).trim();
  return { dim: get('--text-dim'), main: get('--text-main'), grid: get('--chart-grid'), tipBg: get('--tip-bg'), tipBorder: get('--tip-border') };
};

// marker and hover labels: a border and a background that differ from the plot in every theme
const tipStyle = () => {
  const c = colors();
  return { backgroundColor: c.tipBg, borderColor: c.tipBorder, borderWidth: 1, titleFontColor: c.main, bodyFontColor: c.main, cornerRadius: 6 };
};

// A marker is a larger diamond with a ring in the text colour, so that it shows on the curve in every theme. The options are
// scriptable: Chart.js asks per point while it builds the elements, so nothing is stored in the datasets. `marked` and `ring`
// are set in update() before each chart.update().
let marked = new Set();
let ring = '';
const markerOptions = (color) => ({
  pointRadius: (c) => (marked.has(c.dataIndex) ? 7 : 2),
  pointStyle: (c) => (marked.has(c.dataIndex) ? 'rectRot' : 'circle'),
  pointBackgroundColor: color,
  pointBorderColor: (c) => (marked.has(c.dataIndex) ? ring : color),
  pointBorderWidth: (c) => (marked.has(c.dataIndex) ? 2 : 1),
});

// "Min" or "Max" for a marker that follows the minimum or maximum of the first trace
const markerTag = (freq) => {
  const m = store.markers.find(x => x.show && x.track && x.freq === freq);
  return m ? (m.track === 'min' ? 'Min' : 'Max') : '';
};

const canvasRef = ref(null);
let chart = null;

const initChart = () => {
  if (!canvasRef.value) return;

  const ctx = canvasRef.value.getContext('2d');
  let config;
  chartKind = kind();
  if (chartKind === 'smith') config = getSmithConfig();
  else if (chartKind === 'polar') config = getPolarConfig();
  else config = getFreqConfig();
  
  chart = new Chart(ctx, config);
};

const getFreqConfig = () => ({
  type: 'line',
  data: { labels: [], datasets: [] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    scales: {
      xAxes: [{
        ticks: { callback: (value) => dsp.formatFrequency(value, 3), fontColor: colors().dim },
        gridLines: { color: colors().grid }
      }],
      yAxes: [
        { id: 'y-axis-dB', position: 'left', ticks: { fontColor: colors().dim, min: store.scales.logmag.min, max: store.scales.logmag.max }, gridLines: { color: colors().grid }, scaleLabel: { display: true, labelString: 'dB' } },
        { id: 'y-axis-swr', position: 'right', display: false, ticks: { fontColor: colors().dim, min: store.scales.swr.min, max: store.scales.swr.max }, gridLines: { color: colors().grid }, scaleLabel: { display: true, labelString: 'SWR' } },
        { id: 'y-axis-phase', position: 'right', display: false, ticks: { fontColor: colors().dim, min: store.scales.phase.min, max: store.scales.phase.max }, gridLines: { color: colors().grid }, scaleLabel: { display: true, labelString: 'Phase' } },
        { id: 'y-axis-auto', position: 'right', display: false, ticks: { fontColor: colors().dim }, gridLines: { drawOnChartArea: false }, scaleLabel: { display: true, labelString: '' } }
      ]
    },
    legend: { labels: { fontColor: colors().main } },
    tooltips: {
      ...tipStyle(),
      position: 'firstPoint',
      callbacks: {
        title: (tooltipItems, data) => {
          if (tooltipItems.length > 0) {
            const tag = markerTag(+tooltipItems[0].xLabel);
            // with several traces say which one decides: the first one
            const first = data.datasets.length > 1 && data.datasets[0].label ? ' ' + data.datasets[0].label : '';
            return (tag ? tag + first + ' · ' : '') + dsp.formatFrequency(tooltipItems[0].xLabel);
          }
          return '';
        },
        label: (tooltipItem, data) => {
          const datasetLabel = data.datasets[tooltipItem.datasetIndex].label || '';
          const value = tooltipItem.yLabel;
          const format = data.datasets[tooltipItem.datasetIndex].format;
          const formattedValue = dsp.formatTraceValue(format, value);

          return datasetLabel + ': ' + formattedValue;
        }
      }
    }
  }
});

// Γ plane: x = real, y = imaginary, both -1 to 1 (stretched to the chart area)
const getPolarConfig = () => ({
  type: 'scatter',
  data: { datasets: [] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    scales: {
      xAxes: [{ ticks: { min: -1, max: 1, stepSize: 0.5, fontColor: colors().dim }, gridLines: { color: colors().grid } }],
      yAxes: [{ ticks: { min: -1, max: 1, stepSize: 0.5, fontColor: colors().dim }, gridLines: { color: colors().grid } }]
    },
    legend: { labels: { fontColor: colors().main } },
    tooltips: {
      ...tipStyle(),
      callbacks: {
        label: (tooltipItem, data) => {
          const ds = data.datasets[tooltipItem.datasetIndex];
          const point = ds.data[tooltipItem.index];
          return [ds.label, 'Freq: ' + dsp.formatFrequency(point.freq || 0), 'Real: ' + point.x.toFixed(3), 'Imag: ' + point.y.toFixed(3)];
        }
      }
    }
  }
});

const getSmithConfig = () => ({
  type: 'smith',
  data: { datasets: [] },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    scale: { gridLines: { color: colors().grid }, ticks: { fontColor: colors().dim } },
    legend: { labels: { fontColor: colors().main } },
    tooltips: {
      ...tipStyle(),
      callbacks: {
        label: (tooltipItem, data) => {
          const datasetLabel = data.datasets[tooltipItem.datasetIndex].label || '';
          const point = data.datasets[tooltipItem.datasetIndex].data[tooltipItem.index];
          if (point && typeof point === 'object') {
            return [
              datasetLabel,
              'Freq: ' + dsp.formatFrequency(point.freq || 0),
              'Real: ' + (point.real || 0).toFixed(3),
              'Imag: ' + (point.imag || 0).toFixed(3)
            ];
          }
          return datasetLabel;
        }
      }
    }
  }
});

const AXES = { logmag: 'y-axis-dB', swr: 'y-axis-swr', phase: 'y-axis-phase', linear: 'y-axis-dB', real: 'y-axis-dB', imag: 'y-axis-dB' };
const AXIS_NAME = { R: 'Ω', X: 'Ω', Z: 'Ω', Rp: 'Ω', Xp: 'Ω', Q: 'Q', gd: 'delay (ns)' };

const updateChart = async () => {
  if (!chart) return;

  if (kind() !== chartKind) {
    chart.destroy();
    initChart();
  }

  const traces = store.traces.filter(t => t.show && (props.type === 'smith' ? dsp.SMITH_FORMATS.includes(t.format) : dsp.FREQ_FORMATS.includes(t.format)));
  const channelData = (t) => (t.channel === 0 ? store.data.ch0 : store.data.ch1);
  const shownMarkers = store.markers.filter(m => m.show);
  const labels = chartKind === 'frequency' ? (store.frequencies.data || []) : [];
  marked = new Set(shownMarkers.map(m => labels.findIndex(f => f >= m.freq)).filter(i => i >= 0));
  ring = colors().main;

  if (chartKind === 'frequency') {
    chart.data.labels = store.frequencies.data || [];
    chart.data.datasets = traces.map(t => ({
      label: `CH${t.channel} ${t.format}`,
      format: t.format,
      data: dsp.traceValues(channelData(t), t.format),
      borderColor: t.color,
      backgroundColor: t.color, // fills the colour boxes of legend and tooltip
      fill: false,
      borderWidth: 2,
      ...markerOptions(t.color),
      yAxisID: AXES[t.format] || 'y-axis-auto'
    }));
    // formats without a fixed scale share one automatic axis on the right
    const auto = traces.filter(t => !AXES[t.format]);
    const axis = chart.options && chart.options.scales.yAxes.find(a => a.id === 'y-axis-auto');
    if (axis) {
      axis.display = auto.length > 0;
      axis.scaleLabel.labelString = [...new Set(auto.map(t => AXIS_NAME[t.format] || t.format))].join(', ');
    }
  } else if (chartKind === 'polar') {
    chart.data.datasets = traces.map(t => ({
      label: `CH${t.channel} Polar`,
      data: channelData(t).map(d => ({ x: d.real, y: d.imag, freq: d.freq })),
      borderColor: t.color,
      backgroundColor: t.color,
      showLine: true,
      borderWidth: 2,
      ...markerOptions(t.color),
      fill: false
    }));
  } else {
    // Smith chart: z = (1 + Γ) / (1 - Γ); the admittance chart mirrors Γ so that y is read on the same grid
    chart.data.datasets = traces.map(t => ({
      label: `CH${t.channel} ${t.format === 'ysmith' ? 'Y Smith' : 'Smith'}`,
      data: channelData(t).map(d => (t.format === 'ysmith' ? dsp.calcYr(d) : dsp.calcZr(d))),  // {freq, real, imag}
      borderColor: t.color,
      borderWidth: 2,
      ...markerOptions(t.color),
      fill: false
    }));
  }

  // Set marker positions for pinnedTooltips plugin
  chart.config.options.pinnedTooltips = shownMarkers.map(m => m.freq);
  
  chart.update();
};

// Use watchEffect to automatically track all reactive dependencies
watchEffect(() => {
    // Access dataVersion to establish dependency tracking
    const version = store.dataVersion;
    updateChart();
});
watch(() => [props.type, store.themeEffective], () => {
    if (chart) chart.destroy();
    initChart();
    updateChart();
});
watch(() => store.scales, () => {
  if (!chart || chartKind !== 'frequency') return;
  const axes = chart.options.scales.yAxes;
  axes.find(a => a.id === 'y-axis-dB').ticks.min = store.scales.logmag.min;
  axes.find(a => a.id === 'y-axis-dB').ticks.max = store.scales.logmag.max;
  axes.find(a => a.id === 'y-axis-swr').ticks.min = store.scales.swr.min;
  axes.find(a => a.id === 'y-axis-swr').ticks.max = store.scales.swr.max;
  axes.find(a => a.id === 'y-axis-phase').ticks.min = store.scales.phase.min;
  axes.find(a => a.id === 'y-axis-phase').ticks.max = store.scales.phase.max;
  chart.update();
}, { deep: true });
watch(() => store.status, (status) => {
    if (status === 'connected') updateChart();
});

// Two fingers on the Freq chart: horizontal pinch/drag = frequency range (applied on release, it starts a new sweep),
// vertical pinch/drag = scale of the first trace with a fixed axis (live). One finger still scrolls the page.
const hint = ref('');
const SCALE_OF = { logmag: 'logmag', linear: 'logmag', real: 'logmag', imag: 'logmag', swr: 'swr', phase: 'phase' };
const F_MIN = 50e3;
const F_MAX = 900e6;
let gesture = null;

// scale (and its key) the vertical zoom acts on: the first visible trace with a fixed axis
const yKey = () => {
  const trace = store.traces.find(t => t.show && SCALE_OF[t.format]);
  return trace ? SCALE_OF[trace.format] : null;
};
const DEFAULT_SCALES = { logmag: [-80, 0], swr: [1, 10], phase: [-180, 180] };
const setScale = (key, min, max) => {
  const round = (v) => +v.toPrecision(4);
  store.scales[key].min = round(min);
  store.scales[key].max = round(max);
};
const areaOf = () => chart && chartKind === 'frequency' && chart.chartArea ? chart.chartArea : null;

// apply a new frequency range; while paused one sweep of it is taken, started once the range switch is under way
const commitRange = (r) => {
  if (!r || (Math.abs(r[0] - +store.frequencies.start) <= 1 && Math.abs(r[1] - +store.frequencies.stop) <= 1)) return;
  const fr = store.frequencies;
  fr.start = Math.round(r[0]);
  fr.stop = Math.round(r[1]);
  fr.center = (fr.start + fr.stop) / 2;
  fr.span = fr.stop - fr.start;
  if (!store.autoUpdate) {
    nextTick(() => { store.sweepOnce = true; store.autoUpdate = true; });
  }
};
const limitRange = (lo, hi, from) => clampRange(lo, hi, F_MIN, Math.max(F_MAX, from));
const showRange = (r) => { hint.value = r ? dsp.formatFrequency(r[0], 3) + ' – ' + dsp.formatFrequency(r[1], 3) : ''; };

// back to the full range and the default scale
const resetZoom = () => {
  if (!areaOf()) return;
  commitRange([F_MIN, F_MAX]);
  const key = yKey();
  if (key && DEFAULT_SCALES[key]) setScale(key, ...DEFAULT_SCALES[key]);
};

const touchGeometry = (e) => {
  const [a, b] = [e.touches[0], e.touches[1]];
  const r = canvasRef.value.getBoundingClientRect();
  const area = chart.chartArea;
  return {
    dx: Math.abs(a.clientX - b.clientX),
    dy: Math.abs(a.clientY - b.clientY),
    mx: (a.clientX + b.clientX) / 2 - r.left,
    my: (a.clientY + b.clientY) / 2 - r.top,
    area
  };
};

const zoomStart = (e) => {
  if (!chart || chartKind !== 'frequency' || e.touches.length !== 2 || !chart.chartArea) return;
  const g = touchGeometry(e);
  const key = yKey();
  gesture = {
    ...g,
    key,
    y: key ? { ...store.scales[key] } : null,
    lo: +store.frequencies.start,
    hi: +store.frequencies.stop,
    range: null
  };
  e.preventDefault();
};

const zoomMove = (e) => {
  if (!gesture || e.touches.length !== 2) return;
  e.preventDefault();
  const g = touchGeometry(e);
  const s = gesture;
  const w = s.area.right - s.area.left;
  const h = s.area.bottom - s.area.top;
  const ax = Math.min(1, Math.max(0, (s.mx - s.area.left) / w));
  const fx = pinchFactor(s.dx, g.dx);
  s.range = limitRange(...transformRange(s.lo, s.hi, ax, fx, (g.mx - s.mx) / w), s.hi);
  showRange(s.range);
  if (s.key) {
    const ay = Math.min(1, Math.max(0, (s.area.bottom - s.my) / h));
    const fy = pinchFactor(s.dy, g.dy);
    const [min, max] = transformRange(s.y.min, s.y.max, ay, fy, (s.my - g.my) / h);
    setScale(s.key, min, max);
  }
};

let lastTap = 0;
const zoomEnd = (e) => {
  if (!gesture) {
    // a second quick tap resets the zoom
    if (e.type === 'touchend' && e.touches.length === 0 && e.changedTouches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 300) { resetZoom(); lastTap = 0; } else lastTap = now;
    }
    return;
  }
  if (e.touches.length >= 2) return;
  const r = gesture.range;
  gesture = null;
  hint.value = '';
  commitRange(r);
};

// Mouse wheel (and trackpad pinch, which arrives as ctrl + wheel) zooms around the pointer: the frequency range, or
// the value scale with shift. Wheel steps are collected for a moment before a new sweep is started.
let wheelRange = null;
let wheelTimer = null;
const onWheel = (e) => {
  const area = areaOf();
  if (!area) return;
  e.preventDefault();
  const r = canvasRef.value.getBoundingClientRect();
  const delta = e.deltaY || e.deltaX;
  const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002) * (e.deltaMode === 1 ? 16 : 1));
  if (e.shiftKey) {
    const key = yKey();
    if (!key) return;
    const ay = Math.min(1, Math.max(0, (area.bottom - (e.clientY - r.top)) / (area.bottom - area.top)));
    const [min, max] = transformRange(store.scales[key].min, store.scales[key].max, ay, factor);
    setScale(key, min, max);
    return;
  }
  const lo = wheelRange ? wheelRange[0] : +store.frequencies.start;
  const hi = wheelRange ? wheelRange[1] : +store.frequencies.stop;
  const ax = Math.min(1, Math.max(0, (e.clientX - r.left - area.left) / (area.right - area.left)));
  wheelRange = limitRange(...transformRange(lo, hi, ax, factor), hi);
  showRange(wheelRange);
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { const range = wheelRange; wheelRange = null; hint.value = ''; commitRange(range); }, 300);
};

// dragging with the mouse shifts the range and the scale; a click without movement stays a click
let drag = null;
let dragged = false;
const onMouseDown = (e) => {
  const area = areaOf();
  if (!area || e.button !== 0) return;
  const key = yKey();
  drag = { x: e.clientX, y: e.clientY, area, key, lo: +store.frequencies.start, hi: +store.frequencies.stop, y0: key ? { ...store.scales[key] } : null, range: null, moved: false };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
};
const onMouseMove = (e) => {
  const d = drag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
  d.moved = true;
  const w = d.area.right - d.area.left;
  const h = d.area.bottom - d.area.top;
  d.range = limitRange(...transformRange(d.lo, d.hi, 0.5, 1, (e.clientX - d.x) / w), d.hi);
  showRange(d.range);
  if (d.key) {
    const [min, max] = transformRange(d.y0.min, d.y0.max, 0.5, 1, (d.y - e.clientY) / h);
    setScale(d.key, min, max);
  }
};
const onMouseUp = () => {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  const d = drag;
  drag = null;
  if (!d || !d.moved) return;
  dragged = true;
  hint.value = '';
  commitRange(d.range);
};
// the click that ends a drag must not set a marker or toggle a trace
const onClickCapture = (e) => {
  if (dragged) { dragged = false; e.stopPropagation(); }
};

// chart.js only follows window resizes; a turned phone changes the box without the canvas noticing
let observer = null;
onMounted(() => {
  initChart();
  const el = canvasRef.value;
  if (el) {
    el.addEventListener('touchstart', zoomStart, { passive: false });
    el.addEventListener('touchmove', zoomMove, { passive: false });
    el.addEventListener('touchend', zoomEnd);
    el.addEventListener('touchcancel', zoomEnd);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('dblclick', resetZoom);
  }
  if (typeof ResizeObserver === 'function' && canvasRef.value) {
    observer = new ResizeObserver(() => { if (chart && chart.resize) chart.resize(); });
    observer.observe(canvasRef.value.parentElement);
  }
  // some mobile browsers settle the layout a moment after the turn
  window.addEventListener('orientationchange', settle);
});
const settle = () => {
  for (const ms of [0, 150, 500]) setTimeout(() => { if (chart && chart.resize) chart.resize(); }, ms);
};
onUnmounted(() => {
  window.removeEventListener('orientationchange', settle);
  const el = canvasRef.value;
  if (el) {
    el.removeEventListener('touchstart', zoomStart);
    el.removeEventListener('touchmove', zoomMove);
    el.removeEventListener('touchend', zoomEnd);
    el.removeEventListener('touchcancel', zoomEnd);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('mousedown', onMouseDown);
    el.removeEventListener('click', onClickCapture, true);
    el.removeEventListener('dblclick', resetZoom);
  }
  clearTimeout(wheelTimer);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  if (observer) observer.disconnect();
  if (chart) chart.destroy();
});
</script>

<template>
  <ChartFrame :title="props.type === 'smith' ? 'Smith chart' : 'Frequency chart'">
    <div class="graph-container">
      <canvas ref="canvasRef" :data-graph-type="props.type"></canvas>
      <div v-if="hint" class="zoom-hint">{{ hint }}</div>
    </div>
  </ChartFrame>
</template>

<style scoped>
.graph-container {
  width: 100%;
  height: 100%;
  position: relative;
  min-width: 0;
  overflow: hidden;
}
/* a pinch on the chart is the app's, not the page's; one finger still scrolls */
.graph-container canvas { touch-action: pan-x pan-y; }
.zoom-hint {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--primary);
  color: #fff;
  font-size: 12px;
  pointer-events: none;
}
/* chart.js sets pixel sizes on the canvas; after a turn the box is what counts */
.graph-container canvas {
  width: 100% !important;
  height: 100% !important;
}
</style>
