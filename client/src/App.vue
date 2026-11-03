<script setup>
import { ref, onMounted, watch, nextTick } from 'vue';
import { store, connect, disconnect, getWorker, startUpdateLoop, cycleTheme, THEME_LABELS } from './store';
import Graph from './components/Graph.vue';
import Keypad from './components/Keypad.vue';
import TraceDialog from './components/TraceDialog.vue';
import ScaleDialog from './components/ScaleDialog.vue';
import CalibrationDialog from './components/CalibrationDialog.vue';
import AboutDialog from './components/AboutDialog.vue';
import MarkerDialog from './components/MarkerDialog.vue';
import MarkerReadout from './components/MarkerReadout.vue';
import CaptureDialog from './components/CaptureDialog.vue';
import Single from './components/Single.vue';
import Ham from './components/Ham.vue';
import Multi from './components/Multi.vue';
import Cable from './components/Cable.vue';
import Tdr from './components/Tdr.vue';
import SweepDialog from './components/SweepDialog.vue';
import DemoPanel from './components/DemoPanel.vue';
import { HAM_BANDS, bandSweep } from './lib/bands';
import { bandFileName, chartsToPng, download, hamChartItems, multiChartItems, saveTouchstone } from './lib/export';

const isDemo = !!import.meta.env.VITE_DEMO; // the hosted demo with a simulated NanoVNA
const menuVisible = ref(false);
const freqInputSelect = ref('start-stop');
const graphSelected = ref('frequency');
// the Multi view makes the update loop sweep the selected bands one after another
watch(graphSelected, (g) => {
  store.multiActive = g === 'multi';
  store.cableActive = g === 'cable';
  store.tdrActive = g === 'tdr';
});

const showKeypad = ref(false);
const keypadTitle = ref('');
const keypadTarget = ref('');
const keypadValue = ref('');

const showTraceDialog = ref(false);
const currentTrace = ref(null);

const showScaleDialog = ref(false);
const showSweepDialog = ref(false);
const showCalibrationDialog = ref(false);
const showAboutDialog = ref(false);
const showMarkerDialog = ref(false);
const showCaptureDialog = ref(false);

const handleConnect = async () => {
  try {
    await connect();
  } catch (e) {
    alert('Failed to connect: ' + e.message);
  }
};

const keypadUnit = ref('Hz');

const openKeypad = (title, target, value, unit = 'Hz') => {
  keypadTitle.value = title;
  keypadTarget.value = target;
  keypadValue.value = String(value);
  keypadUnit.value = unit;
  showKeypad.value = true;
};

const handleKeypadSubmit = (value) => {
  if (keypadTarget.value.startsWith('range.')) {
    const key = keypadTarget.value.split('.')[1];
    store.frequencies[key] = value;
    if (key === 'start' || key === 'stop') updateStartStop();
    if (key === 'center' || key === 'span') updateCenterSpan();
  } else if (keypadTarget.value === 'single.freq') {
    applySingleFreq(value);
  } else if (keypadTarget.value === 'portext') {
    store.portExtLength = value > 0 ? value : 0;
  } else if (keypadTarget.value === 'ham.cursor') {
    store.hamCursor = value;
  } else if (keypadTarget.value === 'marker.add') {
    store.markers.push({ id: Date.now(), show: true, freq: value, data: [] });
    store.markers.sort((a, b) => a.freq - b.freq);
  } else if (keypadTarget.value.startsWith('frequencies.')) {
    const key = keypadTarget.value.split('.')[1];
    let val = value;
    if (key === 'segments' && val < 1) val = 1;
    store.frequencies[key] = val;
  }
  showKeypad.value = false;
};

const selectSingle = () => {
  graphSelected.value = 'single';
  applySingleFreq(store.singleFreq);
};

// sweep the band with a margin on both sides so that its edges are visible
const selectBand = (band) => {
  graphSelected.value = 'ham';
  store.hamBand = band.name;
  const { start, stop } = bandSweep(band);
  store.frequencies.start = start;
  store.frequencies.stop = stop;
  updateStartStop();
};

// the views in tab order; the tabs and the swipe gesture both go through selectView
const VIEWS = [
  ['single', 'Single'], ['ham', 'HAM'], ['multi', 'Multi'], ['cable', 'Cable'],
  ['smith', 'Smith'], ['frequency', 'Freq'], ['tdr', 'TDR'],
];
const selectView = (id) => {
  if (id === 'single') selectSingle();
  else if (id === 'ham') selectBand(HAM_BANDS.find(b => b.name === store.hamBand) || HAM_BANDS[0]);
  else graphSelected.value = id;
};
// keep the active tab in sight; the tab bar scrolls sideways on a narrow screen
const revealActiveTab = () => document.querySelector('.view-tabs .tab-btn.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
watch(graphSelected, () => nextTick(revealActiveTab));
onMounted(revealActiveTab);

// Swipe sideways to the next or previous view. A view only changes on a clear, fast, mostly
// horizontal move that starts outside charts, fields and sideways-scrolling areas, so that
// scrolling, dragging in a chart or picking a value never switches the view by accident.
const SWIPE_MIN_X = 90, SWIPE_MAX_MS = 600, SWIPE_EDGE = 24;
let swipe = null;
const scrollsSideways = (el) => {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX)) return true;
  }
  return false;
};
const onTouchStart = (e) => {
  swipe = null;
  if (e.touches.length !== 1) return;
  const t = e.touches[0];
  if (t.clientX < SWIPE_EDGE || t.clientX > innerWidth - SWIPE_EDGE) return; // the browser's own back gesture
  if (e.target.closest('canvas, svg, input, select, textarea, button, .tabs-navigation') || scrollsSideways(e.target)) return;
  swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
};
const onTouchEnd = (e) => {
  if (!swipe) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
  const quick = Date.now() - swipe.at <= SWIPE_MAX_MS;
  swipe = null;
  if (!quick || Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < 2 * Math.abs(dy)) return;
  const i = VIEWS.findIndex(([id]) => id === graphSelected.value) + (dx < 0 ? 1 : -1);
  if (i >= 0 && i < VIEWS.length) selectView(VIEWS[i][0]);
};

const applySingleFreq = (freq) => {
  store.singleFreq = freq;
  store.frequencies.center = freq;
  store.frequencies.span = 1000;
  updateCenterSpan();
};

const updateStartStop = () => {
  store.frequencies.center = (store.frequencies.start + store.frequencies.stop) / 2;
  store.frequencies.span = Math.abs(store.frequencies.stop - store.frequencies.start);
};

const updateCenterSpan = () => {
  store.frequencies.start = store.frequencies.center - store.frequencies.span / 2;
  store.frequencies.stop = store.frequencies.center + store.frequencies.span / 2;
};

const openTraceSettings = (trace) => {
  currentTrace.value = trace;
  showTraceDialog.value = true;
};

const formatFrequency = (freq) => {
  if (freq >= 1e9) return (freq / 1e9).toFixed(3) + 'G';
  if (freq >= 1e6) return (freq / 1e6).toFixed(3) + 'M';
  if (freq >= 1e3) return (freq / 1e3).toFixed(3) + 'k';
  return freq + 'Hz';
};

const nameOfFormat = (format) => {
  const formats = {
    smith: 'Smith',
    ysmith: 'Y Smith',
    polar: 'Polar',
    logmag: 'LogMag',
    phase: 'Phase',
    swr: 'SWR',
    linear: 'Linear',
    real: 'Real',
    imag: 'Imag',
    R: 'R',
    X: 'X',
    Z: '|Z|',
    Rp: 'Rp',
    Xp: 'Xp',
    Q: 'Q',
    gd: 'Delay'
  };
  return formats[format] || format;
};

const recallSlot = async (n) => {
  if (store.status !== 'connected') return;
  const worker = await getWorker();

  // Stop update loop momentarily
  store.autoUpdate = false;
  
  await worker.recall(n);
  
  // Refresh configuration from device
  try {
    const config = await worker.refreshConfig();
    if (config) {
      store.frequencies.start = config.start;
      store.frequencies.stop = config.stop;
      // Recall resets to single segment (101 points)
      store.frequencies.segments = config.segments;
      
      const span = config.stop - config.start;
      store.frequencies.span = span;
      store.frequencies.center = config.start + span / 2;
    }
  } catch (e) {
    console.error('Failed to refresh config after recall', e);
  }
  
  store.autoUpdate = true;
  startUpdateLoop(); // Restart loop if it stopped
};


const addMarker = () => {
  openKeypad('Marker Frequency', 'marker.add', '');
};


const pause = () => { store.autoUpdate = false; };
const resume = () => {
   store.autoUpdate = true;
   store.data.ch0 = [];
   store.data.ch1 = [];
};
const stop = () => { store.requestStop = true; };
const refresh = () => {
   store.autoUpdate = true; 
   store.data.ch0 = [];
   store.data.ch1 = [];
};

// Helper function for date formatting (original strftime)
const strftime = (format) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return format
    .replace('%Y', now.getFullYear())
    .replace('%m', pad(now.getMonth() + 1))
    .replace('%d', pad(now.getDate()))
    .replace('%H', pad(now.getHours()))
    .replace('%M', pad(now.getMinutes()))
    .replace('%S', pad(now.getSeconds()));
};

// Download file helper
const downloadFile = (url, filename) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Save As Touchstone format
const saveAs = (format) => {
  if (store.status !== 'connected') return;
  if (format === 's1p' && graphSelected.value === 'multi') {
    saveMultiS1p();
    return;
  }
  if (!store.data.ch0.length) return;

  if (format === 's1p' && graphSelected.value === 'ham') {
    saveTouchstone(store.data.ch0, bandFileName(store.hamBand, 's1p'));
  } else if (format === 's1p') {
    const body = ['# Hz S RI R 50\n'];
    store.data.ch0.forEach((d) => {
      body.push(`${d.freq}\t${d.real}\t${d.imag}\n`);
    });
    const blob = new Blob(body, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const name = `nanovna-${strftime('%Y%m%d-%H%M%S')}.s1p`;
    downloadFile(url, name);
  } else if (format === 's2p') {
    const body = ['# Hz S RI R 50\n'];
    store.data.ch0.forEach((ch0, i) => {
      const ch1 = store.data.ch1[i] || { real: 0, imag: 0 };
      body.push(`${ch0.freq}\t${ch0.real}\t${ch0.imag}\t${ch1.real}\t${ch1.imag}\t${ch1.real}\t${ch1.imag}\t${ch0.real}\t${ch0.imag}\n`);
    });
    const blob = new Blob(body, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const name = `nanovna-${strftime('%Y%m%d-%H%M%S')}.s2p`;
    downloadFile(url, name);
  }
};

// Multi: one file per measured band; browsers drop downloads started in the same instant
const saveMultiS1p = async () => {
  for (const name of store.multiBands.filter(n => store.multi[n] && store.multi[n].points.length)) {
    saveTouchstone(store.multi[name].points, bandFileName(name, 's1p'));
    await new Promise(r => setTimeout(r, 300));
  }
};

// HAM and Multi draw SVG charts: all of them go into one picture
const saveSvgPng = async (graphType) => {
  const root = document.querySelector(graphType === 'ham' ? '.ham' : '.multi');
  if (!root) return;
  const items = graphType === 'ham' ? hamChartItems(root, store.hamBand) : multiChartItems(root);
  const name = graphType === 'ham' ? bandFileName(store.hamBand, 'png') : 'multi-' + bandFileName(store.multiBands.join('-'), 'png');
  download(await chartsToPng(items), name);
};

// Save chart as PNG
const graphRefs = ref({});
const saveAsPng = (graphType) => {
  const canvas = document.querySelector(`canvas[data-graph-type="${graphType}"]`);
  if (!canvas) return;
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const name = `graph-${strftime('%Y%m%d-%H%M%S')}.png`;
    downloadFile(url, name);
  });
};

// Add new trace
const addTrace = () => {
  const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#f57c00', '#ff9800', '#ff5722'];
  const usedColors = store.traces.map(t => t.color);
  const availableColor = colors.find(c => !usedColors.includes(c)) || colors[Math.floor(Math.random() * colors.length)];
  
  const newId = Math.max(...store.traces.map(t => t.id), -1) + 1;
  currentTrace.value = {
    id: newId,
    show: true,
    channel: 0,
    format: 'logmag',
    scale: 10.0,
    offset: 0,
    color: availableColor,
    type: 'clear',
    avgCount: 2,
    isNew: true
  };
  showTraceDialog.value = true;
};

const handleTraceSave = (trace) => {
  if (trace.isNew) {
    delete trace.isNew;
    store.traces.push(trace);
  }
  showTraceDialog.value = false;
};

const handleTraceDelete = (trace) => {
  if (confirm('Delete this trace?')) {
    const idx = store.traces.findIndex(t => t.id === trace.id);
    if (idx !== -1) {
      store.traces.splice(idx, 1);
    }
    showTraceDialog.value = false;
  }
};


// Quit (close window)
const quit = () => {
  if (confirm('Close this window?')) {
    window.close();
  }
};
</script>

<template>
  <div class="app-container">
    <!-- Toolbar -->
    <header class="header">
      <button class="btn btn-icon" @click="menuVisible = !menuVisible">
        <span class="icon">menu</span>
      </button>
      <h3 class="md-title" style="flex: 1; margin-left: 12px;">
        NanoVNA
        <span v-if="store.version" class="version" style="font-size: 0.8em; opacity: 0.7; margin-left: 8px;">
          ({{ store.version.trim() }})
        </span>
      </h3>
      
      <button class="btn btn-icon" @click="cycleTheme" :title="'Colour scheme: ' + THEME_LABELS[store.theme] + ' (tap to change)'" :aria-label="'Colour scheme: ' + THEME_LABELS[store.theme]">
        <span class="icon">{{ { auto: 'brightness_auto', light: 'light_mode', dark: 'dark_mode' }[store.theme] }}</span>
      </button>

      <button class="btn btn-primary" v-if="store.status === 'disconnected'" @click="handleConnect">
        <span class="icon">usb</span>&nbsp;connect
      </button>
      <button class="btn btn-primary" v-else-if="store.status === 'connecting'" disabled>
        <span class="icon">usb</span>&nbsp;connecting...
      </button>
      
      <template v-else-if="store.status === 'connected'">
        <template v-if="store.frequencies.length <= 101">
          <button class="btn btn-primary" v-if="store.autoUpdate" @click="pause">
            <span class="icon">pause</span>&nbsp;Pause
          </button>
          <button class="btn btn-primary" v-else @click="resume">
            <span class="icon">refresh</span>&nbsp;Resume
          </button>
        </template>
        <template v-else>
          <button class="btn btn-primary" v-if="store.updating" @click="stop" :disabled="store.requestStop">
            <span class="icon">pause</span>&nbsp;Stop [{{store.progress.value}}/{{store.progress.total}}]
          </button>
          <button class="btn btn-primary" v-else @click="refresh">
            <span class="icon">refresh</span>&nbsp;Update
          </button>
        </template>
      </template>
    </header>

    <DemoPanel v-if="isDemo" />

    <div class="stale fw-note" v-if="store.status === 'connected' && store.fwNew && store.fwNew.tag !== store.fwDismissed">
      <span>A newer NanoVNA firmware is available: {{ store.fwNew.tag }} (installed: {{ store.version.trim() }}).
        <a :href="store.fwNew.url" target="_blank" rel="noopener">Release page</a></span>
      <button class="btn" @click="store.fwDismissed = store.fwNew.tag">Dismiss</button>
    </div>

    <div class="stale" v-if="store.status === 'connected' && store.autoUpdate && (store.deviceFrozen || store.silentSecs > 6)">
      <template v-if="store.deviceFrozen">The NanoVNA delivers no new measurements (the values no longer change). Please restart the NanoVNA.</template>
      <template v-else>No data from the NanoVNA for {{ store.silentSecs }} s. Check the connection or restart the NanoVNA.</template>
    </div>

    <!-- Drawer Overlay -->
    <div class="drawer-overlay" v-if="menuVisible" @click="menuVisible = false"></div>

    <!-- Sidebar Drawer -->
    <aside class="drawer" :class="{ open: menuVisible }">
      <div style="padding: 16px; font-size: 14px; color: var(--text-dim); font-weight: 500;">Actions</div>
      <div class="divider"></div>
      
      <div class="nav-section">
        <div class="nav-subheader">Graph</div>
        <button class="btn-nav" @click="showMarkerDialog = true; menuVisible = false">
          <span class="icon">label</span> Setup Markers
        </button>
        <button class="btn-nav" @click="showScaleDialog = true; menuVisible = false">
          <span class="icon">height</span> Setup Scales
        </button>
        <button class="btn-nav" @click="addTrace">
          <span class="icon">add</span> Add Trace
        </button>
        <button class="btn-nav" @click="openKeypad('Segments', 'frequencies.segments', store.frequencies.segments, '')">
          <span class="icon">gradient</span> Resolution...
        </button>

        <button class="btn-nav" @click="openKeypad('Port extension (m of line, VF ' + store.velocityFactor + ')', 'portext', store.portExtLength, 'm')">
          <span class="icon">straighten</span> Port extension{{ store.portExtLength > 0 ? ': ' + store.portExtLength + ' m' : '...' }}
        </button>

        <div class="nav-subheader">Device</div>
        <button class="btn-nav" @click="showSweepDialog = true; menuVisible = false" :disabled="store.status !== 'connected'">
          <span class="icon">tune</span> Sweep quality...
        </button>
        <button class="btn-nav" @click="handleConnect" v-if="store.status === 'disconnected'">
          <span class="icon">usb</span> Connect
        </button>
        <button class="btn-nav" disabled v-else-if="store.status === 'connecting'">
          <span class="icon">usb</span> Connect
        </button>
        <button class="btn-nav" @click="disconnect" v-else>
          <span class="icon">cancel</span> Disconnect
        </button>

        <div style="padding: 0 16px; margin: 8px 0;">
          <label style="font-size: 11px; color: var(--text-dim); display: block; margin-bottom: 4px;">Connection Type</label>
          <select v-model="store.connectionType" class="field-input" style="width: 100%;">
            <option value="auto">Auto (Default)</option>
            <option value="serial">WebSerial</option>
            <option value="usb">WebUSB</option>
            <option value="ws">WiFi bridge (ESP32)</option>
          </select>
          <input v-if="store.connectionType === 'ws'" v-model="store.wsHost" placeholder="nanovna.local or IP" class="field-input" style="width: 100%; margin-top: 4px;">
        </div>
        
        <div class="nav-subheader">Save</div>
        <button class="btn-nav" @click="saveAs('s1p')" :disabled="store.status !== 'connected'">
          <span class="icon">save_alt</span> {{ graphSelected === 'multi' ? 'Save As .s1p (one per band)' : 'Save As .s1p' }}
        </button>
        <button class="btn-nav" @click="saveAs('s2p')" :disabled="store.status !== 'connected'">
          <span class="icon">save_alt</span> Save As .s2p
        </button>
        <button class="btn-nav" @click="saveSvgPng(graphSelected)" :disabled="store.status !== 'connected'" v-show="graphSelected === 'ham' || graphSelected === 'multi'">
          <span class="icon">image</span> Save Charts As .png
        </button>
        <button class="btn-nav" @click="saveAsPng('smith')" :disabled="store.status !== 'connected'" v-show="graphSelected === 'smith'">
          <span class="icon">image</span> Save Smith Chart As .png
        </button>
        <button class="btn-nav" @click="saveAsPng('frequency')" :disabled="store.status !== 'connected'" v-show="graphSelected === 'frequency'">
          <span class="icon">image</span> Save Freq Chart As .png
        </button>
        <button class="btn-nav" @click="showCaptureDialog = true; menuVisible = false" :disabled="store.status !== 'connected'">
          <span class="icon">video_label</span> Capture Device
        </button>

        <div class="divider"></div>

        <div class="nav-subheader">State</div>
        <button class="btn-nav" @click="showCalibrationDialog = true; menuVisible = false" :disabled="store.status !== 'connected'">
          <span class="icon">settings_input_antenna</span> Calibrate...
        </button>
        <button class="btn-nav" v-for="n in [0, 1, 2, 3, 4]" :key="n" @click="recallSlot(n)" :disabled="store.status !== 'connected'">
          <span class="icon">arrow_left</span> Recall {{n}}
        </button>

        <div class="divider"></div>
        
        <div class="nav-subheader">About</div>
        <button class="btn-nav" @click="showAboutDialog = true; menuVisible = false">
          <span class="icon">info</span> Version
        </button>
        <button class="btn-nav" @click="quit">
          <span class="icon">exit_to_app</span> Quit
        </button>
      </div>
      <div class="divider"></div>
      <div class="nav-section">
        <div class="nav-subheader">Debug Logs</div>
        <div style="background: var(--tile-bg); padding: 8px; font-size: 10px; font-family: monospace; height: 200px; overflow-y: auto; white-space: pre-wrap;">
          <div v-for="(log, i) in store.debugLogs" :key="i">{{ log }}</div>
        </div>
        <button class="btn-nav" @click="store.debugLogs = []">Clear Logs</button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div class="graph-area" :class="{ 'has-inputs': !['single', 'ham', 'multi', 'cable', 'tdr'].includes(graphSelected) }">
        <div class="tabs-navigation view-tabs">
          <button v-for="[id, name] in VIEWS" :key="id" class="tab-btn" :class="{ active: graphSelected === id }" @click="selectView(id)">{{ name }}</button>
        </div>
        <div class="input-panel" v-show="!['single', 'ham', 'multi', 'cable', 'tdr'].includes(graphSelected)">
          <div class="tabs-navigation">
            <button class="tab-btn" :class="{ active: freqInputSelect === 'start-stop' }" @click="freqInputSelect = 'start-stop'">Start/Stop</button>
            <button class="tab-btn" :class="{ active: freqInputSelect === 'center-span' }" @click="freqInputSelect = 'center-span'">Center/Span</button>
          </div>
        
          <div class="freq-inputs" v-if="freqInputSelect === 'start-stop'">
            <div class="input-group">
              <label>Start</label>
              <div class="field" @click="openKeypad('Start Frequency', 'range.start', store.frequencies.start)">
                {{ formatFrequency(store.frequencies.start) }}
              </div>
            </div>
            <div class="input-group">
              <label>Stop</label>
              <div class="field" @click="openKeypad('Stop Frequency', 'range.stop', store.frequencies.stop)">
                {{ formatFrequency(store.frequencies.stop) }}
              </div>
            </div>
          </div>

          <div class="freq-inputs" v-if="freqInputSelect === 'center-span'">
            <div class="input-group">
              <label>Center</label>
              <div class="field" @click="openKeypad('Center Frequency', 'range.center', store.frequencies.center)">
                {{ formatFrequency(store.frequencies.center) }}
              </div>
            </div>
            <div class="input-group">
              <label>Span</label>
              <div class="field" @click="openKeypad('Frequency Span', 'range.span', store.frequencies.span)">
                {{ formatFrequency(store.frequencies.span) }}
              </div>
            </div>
          </div>

          <div class="traces-chips">
            <button v-for="trace in store.traces" :key="trace.id" 
                    class="chip" 
                    :style="{ backgroundColor: trace.show ? trace.color : 'var(--surface-3)', color: trace.show ? '#fff' : 'var(--text-main)' }"
                    @click="openTraceSettings(trace)">
              CH{{ trace.channel }} {{ nameOfFormat(trace.format) }}
            </button>
          </div>
        </div>
        <div class="graph-wrapper">
          <Single v-if="graphSelected === 'single'" @edit-frequency="openKeypad('Frequency', 'single.freq', store.singleFreq)" />
          <Ham v-else-if="graphSelected === 'ham'" @select-band="selectBand" @edit-cursor="(f) => openKeypad('Cursor frequency', 'ham.cursor', f)" />
          <Multi v-else-if="graphSelected === 'multi'" />
          <Cable v-else-if="graphSelected === 'cable'" />
          <Tdr v-else-if="graphSelected === 'tdr'" />
          <Graph v-else :type="graphSelected" />
        </div>
        <MarkerReadout v-if="graphSelected === 'smith' || graphSelected === 'frequency'" />
      </div>
    </main>

    <!-- Dialogs -->
    <Keypad v-if="showKeypad" 
            :title="keypadTitle" 
            :modelValue="keypadValue" 
            :unit="keypadUnit"
            @submit="handleKeypadSubmit" 
            @close="showKeypad = false" />
    
    <TraceDialog v-if="showTraceDialog" 
                 :show="showTraceDialog"
                 :trace="currentTrace" 
                 @save="handleTraceSave"
                 @delete="handleTraceDelete"
                 @close="showTraceDialog = false" />
    
    <SweepDialog v-if="showSweepDialog" @close="showSweepDialog = false" />
    <ScaleDialog v-if="showScaleDialog" 
                 :show="showScaleDialog"
                 @close="showScaleDialog = false" />
    
    <AboutDialog :show="showAboutDialog" @close="showAboutDialog = false" v-if="showAboutDialog" />
                 
    <CalibrationDialog v-if="showCalibrationDialog" 
                       :show="showCalibrationDialog"
                       @close="showCalibrationDialog = false" />
    
    <MarkerDialog v-if="showMarkerDialog"
                  :show="showMarkerDialog"
                  @close="showMarkerDialog = false"
                  @add-marker="showMarkerDialog = false; addMarker()" />
    
    <CaptureDialog v-if="showCaptureDialog"
                   :show="showCaptureDialog"
                   @close="showCaptureDialog = false" />
  </div>
</template>

<style scoped>
.fw-note { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fw-note a { color: var(--primary); }
.stale { padding: 8px 16px; background: var(--notice-bg); color: var(--text-main); font-size: 14px; flex-shrink: 0; }

/* .btn-inverse removed */

.nav-section {
  display: flex;
  flex-direction: column;
}

.nav-subheader {
  padding: 16px;
  font-size: 12px;
  color: var(--text-dim);
}

.btn-nav {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 16px;
  min-height: max(48px, var(--tap));
  border: none;
  background: transparent;
  width: 100%;
  text-align: left;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.btn-nav:hover {
  background: var(--hover-bg);
}

.btn-nav .icon {
  color: var(--text-dim);
}

.input-panel {
  margin: 16px 0 24px;
}

.freq-inputs {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}

.input-group {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.input-group label {
  font-size: 12px;
  color: var(--text-dim);
  margin-bottom: 4px;
}

.field {
  min-height: max(32px, var(--tap));
  border-bottom: 1px solid var(--divider);
  display: flex;
  align-items: center;
  font-size: 16px;
  cursor: pointer;
}

.traces-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 16px;
}

.graph-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 400px;
}

.graph-wrapper {
  flex: 1;
  min-height: 320px;
  min-width: 0; /* the canvas keeps its old pixel width after a turn; it must not hold the box open */
  overflow: hidden;
  position: relative;
  background: var(--surface-color);
  border: 1px solid var(--divider);
  border-radius: var(--radius);
}

.slot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px;
  font-size: 13px;
}

.marker-list {
  padding: 0 8px;
}

.marker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--tile-bg);
  border-radius: 4px;
  margin-bottom: 4px;
}

.marker-info {
  display: flex;
  flex-direction: column;
}

.marker-id {
  font-size: 10px;
  font-weight: bold;
  color: var(--primary);
}

.marker-freq {
  font-size: 12px;
}

.btn-icon {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}

.btn-icon .icon {
  font-size: 18px;
  color: var(--text-dim);
}

.slot-actions {
  display: flex;
  gap: 8px;
}

/* Phone in portrait: tighter spacing so that the chart starts higher up */
@media (max-width: 480px) {
  .input-panel {
    margin: 8px 0 12px;
  }

  .freq-inputs,
  .traces-chips {
    margin-top: 8px;
  }
}

/* A phone held sideways: the frequency inputs go next to the chart instead of above it */
@media (orientation: landscape) and (max-height: 500px) {
  .graph-area {
    min-height: 0;
  }

  .graph-area.has-inputs {
    display: grid;
    grid-template-columns: minmax(240px, 36%) minmax(0, 1fr);
    grid-template-rows: auto auto 1fr;
    column-gap: 8px;
    flex: 1;
  }

  .graph-area.has-inputs > .view-tabs {
    grid-column: 1 / -1;
  }

  .graph-area.has-inputs > .input-panel {
    grid-column: 1;
    grid-row: 2;
    margin: 4px 0;
    overflow: visible;
    min-height: min-content;
  }

  /* the chart spans the inputs and the readout column; min-width 0 lets it follow the window when the phone is turned */
  .graph-area.has-inputs > .graph-wrapper {
    grid-column: 2;
    grid-row: 2 / span 2;
    min-height: 70vh;
    min-width: 0;
    overflow: hidden;
  }
}
</style>
