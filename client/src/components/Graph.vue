<script setup>
import { onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import Chart from 'chart.js';
import 'chartjs-chart-smith';
import { store, getWorker } from '../store';
import * as dsp from '../lib/dsp';

// Register Chart.js plugin for pinned tooltips (markers)
Chart.pluginService.register({
  beforeRender: function (chart) {
    if (chart.config.options.pinnedTooltips && chart.config.options.pinnedTooltips.length > 0) {
      // Create array of tooltips for markers
      chart.pluginTooltips = [];

      const indexes = chart.config.options.pinnedTooltips.map((freq) => {
        return chart.data.labels.findIndex((f) => f >= freq);
      }).filter(i => i >= 0);

      const pointRadius = [];
      const pointStyle = [];
      
      for (let target of indexes) {
        pointRadius[target] = 5;
        pointStyle[target] = 'rectRot';

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

      for (let dataset of chart.data.datasets) {
        dataset.pointRadius = pointRadius;
        dataset.pointStyle = pointStyle;
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
  return { dim: get('--text-dim'), main: get('--text-main'), grid: get('--chart-grid') };
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
      callbacks: {
        title: (tooltipItems) => {
          if (tooltipItems.length > 0) {
            return dsp.formatFrequency(tooltipItems[0].xLabel);
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

  if (chartKind === 'frequency') {
    chart.data.labels = store.frequencies.data || [];
    chart.data.datasets = traces.map(t => ({
      label: `CH${t.channel} ${t.format}`,
      format: t.format,
      data: dsp.traceValues(channelData(t), t.format),
      borderColor: t.color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 2,
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
      backgroundColor: 'transparent',
      showLine: true,
      borderWidth: 2,
      pointRadius: 2,
      fill: false
    }));
  } else {
    // Smith chart: z = (1 + Γ) / (1 - Γ); the admittance chart mirrors Γ so that y is read on the same grid
    chart.data.datasets = traces.map(t => ({
      label: `CH${t.channel} ${t.format === 'ysmith' ? 'Y Smith' : 'Smith'}`,
      data: channelData(t).map(d => (t.format === 'ysmith' ? dsp.calcYr(d) : dsp.calcZr(d))),  // {freq, real, imag}
      borderColor: t.color,
      borderWidth: 2,
      pointRadius: 2,
      fill: false
    }));
  }

  // Set marker positions for pinnedTooltips plugin
  chart.config.options.pinnedTooltips = store.markers.filter(m => m.show).map(m => m.freq);
  
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

// chart.js only follows window resizes; a turned phone changes the box without the canvas noticing
let observer = null;
onMounted(() => {
  initChart();
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
  if (observer) observer.disconnect();
  if (chart) chart.destroy();
});
</script>

<template>
  <div class="graph-container">
    <canvas ref="canvasRef" :data-graph-type="props.type"></canvas>
  </div>
</template>

<style scoped>
.graph-container {
  width: 100%;
  height: 100%;
  position: relative;
  min-width: 0;
  overflow: hidden;
}
/* chart.js sets pixel sizes on the canvas; after a turn the box is what counts */
.graph-container canvas {
  width: 100% !important;
  height: 100% !important;
}
</style>
