import { reactive, watch } from 'vue';
import * as Comlink from 'comlink';
import { NanoVNA_WebSerial, NanoVNA_WebUSB, NanoVNA_WebSocket } from './lib/nanovna';
import { HAM_BANDS, bandSweep } from './lib/bands';
import { CABLE_RANGES, portExtend, C } from './lib/cable';
import { TDR_RANGES } from './lib/tdr';
import { newerFirmware } from './lib/fwcheck';
import { SWR_LIMITS } from './lib/resonance';
import { appCal, applyCal, solveOSL, checkStandard, pullFromDevice, pushToDevice } from './lib/oslcal';

// The bridge address: ?host=<name or ip> in the URL, or the host the page itself was served from (when it is the ESP32)
function defaultWsHost() {
    const fromUrl = new URLSearchParams(location.search).get('host');
    if (fromUrl) return fromUrl;
    return '';
}

const STORAGE_KEY = 'nanovna-web-client-state';

const defaultState = {
    status: 'disconnected',
    frequencies: {
        start: 1e6,
        stop: 900e6,
        center: 450.5e6,
        span: 899e6,
        length: 101, // points
        segments: 1,  // missing in previous
    },
    connectionType: 'auto', // 'auto', 'serial', 'usb', 'ws' (ESP32 WiFi bridge)
    wsHost: defaultWsHost(),
    traces: [
        { id: 0, show: true, channel: 0, format: 'smith', scale: 1.0, offset: 0, color: '#f44336', type: 'clear', avgCount: 2 },
        { id: 1, show: true, channel: 0, format: 'logmag', scale: 10.0, offset: 0, color: '#4caf50', type: 'clear', avgCount: 2 },
        { id: 2, show: false, channel: 1, format: 'logmag', scale: 10.0, offset: 0, color: '#2196f3', type: 'clear', avgCount: 2 },
        { id: 3, show: false, channel: 1, format: 'phase', scale: 90.0, offset: 0, color: '#f57c00', type: 'clear', avgCount: 2 }
    ],
    data: {
        ch0: [],  // Array of {freq, real, imag}
        ch1: []   // Array of {freq, real, imag}
    },
    markers: [
        { id: 0, show: true, freq: 1e6, data: [] }
    ],
    activeMarker: 0,
    activeMarkerId: 0, // marker that the search and the range buttons act on, and the delta reference
    markerDelta: false,
    updating: false,
    requestStop: false, // Added for Stop button
    progress: { value: 0, total: 0 },
    scales: {
        logmag: { min: -80, max: 0 },
        swr: { min: 1, max: 10 },
        phase: { min: -180, max: 180 },
        linear: { min: 0, max: 1 },
        z: { min: -100, max: 100 }
    },
    autoUpdate: true,
    sweepOnce: false, // paused: take one sweep (a changed range) and pause again
    calibrationRunning: false,
    appCalCovered: 1, // share of the displayed points that the app-side calibration covers
    hamBand: '2 m',
    swrLimit: 2, // SWR limit of the usable bandwidth in the HAM and Multi views (1.5, 2 or 3)
    hamExtras: [], // additional charts under the SWR chart of the HAM view: 'rl', 'rx'
    multiBands: ['40 m', '20 m', '2 m'], // bands shown in the Multi view
    multiActive: false, // the Multi view is open: the update loop sweeps the selected bands one after another
    cableActive: false, // the Cable view is open: the update loop sweeps the cable range and keeps the raw readings
    tdrActive: false, // the TDR view is open: like the Cable view it keeps the raw readings of its own sweep in `cable`
    tdrPreset: 'short', // key of TDR_RANGES
    cablePreset: 'long', // key of CABLE_RANGES
    cableZero: {}, // preset -> delay (s) measured with nothing attached, subtracted from the cable delay
    cableLength: 10, // known length in m for the velocity factor measurement
    cable: { points: [], at: 0 }, // latest raw sweep of the cable view
    multi: {}, // band name -> { points, calibrated, at } from the latest sweep of that band
    hamCursorMode: 'manual', // 'manual', or 'min' / 'max': the cursor follows the lowest / highest SWR of the band, not saved
    hamCursor: null, // frequency (Hz) of the cursor in the HAM view, not saved
    theme: 'auto', // 'auto' follows the system, 'light' / 'dark' are the user's choice
    themeEffective: 'light',
    lastDataAt: 0, // when the last measurement arrived
    silentSecs: 0, // seconds without a new measurement while one is expected
    deviceFrozen: false, // the NanoVNA keeps returning exactly the same values
    singleFreq: 145e6, // frequency of the Single view
    velocityFactor: 0.66, // Default for RG58 etc
    portExtLength: 0, // m of line (at velocityFactor) between the NanoVNA and the device under test, removed from the reflection
    version: '',
    bandwidthHz: 1000, // IF bandwidth of the NanoVNA, read from the device; sets how long a sweep takes, not saved
    fwNew: null, // { tag, url } of a newer firmware release for the connected NanoVNA, not saved
    fwDismissed: '', // release tag whose note the user closed
    info: '',
    dataVersion: 0, // Increment to force reactive updates
    debugLogs: [],
};

export function log(msg) {
    const time = new Date().toLocaleTimeString();
    store.debugLogs.push(`[${time}] ${msg}`);
    console.log(msg);
}

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    // Deep copy defaultState to avoid mutating it
    const state = JSON.parse(JSON.stringify(defaultState));

    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Merge primitives
            if (parsed.activeMarker !== undefined) state.activeMarker = parsed.activeMarker;
            if (parsed.activeMarkerId !== undefined) state.activeMarkerId = parsed.activeMarkerId;
            if (typeof parsed.markerDelta === 'boolean') state.markerDelta = parsed.markerDelta;
            if (parsed.autoUpdate !== undefined) state.autoUpdate = parsed.autoUpdate;

            if (parsed.hamBand !== undefined) state.hamBand = parsed.hamBand;
            if (Array.isArray(parsed.multiBands)) state.multiBands = parsed.multiBands;
            if (SWR_LIMITS.includes(parsed.swrLimit)) state.swrLimit = parsed.swrLimit;
            if (Array.isArray(parsed.hamExtras)) state.hamExtras = parsed.hamExtras;
            if (CABLE_RANGES[parsed.cablePreset]) state.cablePreset = parsed.cablePreset;
            if (TDR_RANGES[parsed.tdrPreset]) state.tdrPreset = parsed.tdrPreset;
            if (parsed.cableLength > 0) state.cableLength = parsed.cableLength;
            if (parsed.cableZero && typeof parsed.cableZero === 'object') state.cableZero = parsed.cableZero;
            if (parsed.theme !== undefined) state.theme = parsed.theme;
            if (parsed.singleFreq !== undefined) state.singleFreq = parsed.singleFreq;
            if (parsed.velocityFactor !== undefined) state.velocityFactor = parsed.velocityFactor;
            if (typeof parsed.fwDismissed === 'string') state.fwDismissed = parsed.fwDismissed;
            if (parsed.portExtLength >= 0) state.portExtLength = parsed.portExtLength;
            if (parsed.connectionType !== undefined) state.connectionType = parsed.connectionType;
            if (parsed.wsHost && !new URLSearchParams(location.search).get('host')) state.wsHost = parsed.wsHost;

            // Deep merge nested
            if (parsed.frequencies) {
                state.frequencies = { ...state.frequencies, ...parsed.frequencies };
                if (!state.frequencies.segments || state.frequencies.segments < 1) {
                    state.frequencies.segments = 1;
                }
            }
            if (parsed.traces) state.traces = parsed.traces;
            if (parsed.markers) state.markers = parsed.markers;
            if (parsed.scales) state.scales = { ...state.scales, ...parsed.scales };
        } catch (e) {
            console.error('Failed to load state', e);
        }
    }
    return state;
}

export const store = reactive(loadState());

// delay (s) of the port extension line
export const portDelay = () => (store.portExtLength > 0 ? store.portExtLength / (C * store.velocityFactor) : 0);

watch(store, (newState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        frequencies: newState.frequencies,
        traces: newState.traces.map(t => ({ ...t, data: [] })),
        markers: newState.markers.map(m => ({ ...m, data: [] })),
        activeMarker: newState.activeMarker,
        activeMarkerId: newState.activeMarkerId,
        markerDelta: newState.markerDelta,
        scales: newState.scales,
        velocityFactor: newState.velocityFactor,
        portExtLength: newState.portExtLength,
        fwDismissed: newState.fwDismissed,
        autoUpdate: newState.autoUpdate,
        connectionType: newState.connectionType,
        wsHost: newState.wsHost,
        singleFreq: newState.singleFreq,
        hamBand: newState.hamBand,
        multiBands: newState.multiBands,
        swrLimit: newState.swrLimit,
        hamExtras: newState.hamExtras,
        cablePreset: newState.cablePreset,
        tdrPreset: newState.tdrPreset,
        cableLength: newState.cableLength,
        cableZero: newState.cableZero,
        theme: newState.theme,
    }));
}, { deep: true });

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme() {
    store.themeEffective = store.theme === 'auto' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : store.theme;
    document.documentElement.dataset.theme = store.themeEffective;
    // the browser bar of a phone takes the colour of the page
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', store.themeEffective === 'dark' ? '#151b27' : '#ffffff');
}
watch(() => store.theme, applyTheme, { immediate: true });
if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);

export const THEME_LABELS = { auto: 'follows the system', light: 'light', dark: 'dark' };

// system -> light -> dark -> system
export function cycleTheme() {
    store.theme = { auto: 'light', light: 'dark', dark: 'auto' }[store.theme] || 'auto';
}

// seconds without a measurement, for the "no data" notice
setInterval(() => {
    const expecting = store.status === 'connected' && store.autoUpdate && !store.calibrationRunning && store.lastDataAt > 0;
    store.silentSecs = expecting ? Math.floor((Date.now() - store.lastDataAt) / 1000) : 0;
}, 1000);

let workerInstance = null;
let workerProxy = null;

export async function getWorker() {
    if (!workerProxy) {
        const WorkerConstructor = (await import('./worker?worker')).default;
        workerInstance = new WorkerConstructor();
        workerProxy = Comlink.wrap(workerInstance);
        await workerProxy.init(Comlink.proxy({
            onerror: (err) => {
                store.status = 'error';
                console.error('Worker error:', err);
            },
            ondisconnected: () => {
                store.status = 'disconnected';
            }
        }));
    }
    return workerProxy;
}

// the sweep time depends on the IF bandwidth of the device
export async function refreshBandwidth() {
    try {
        const b = (await (await getWorker()).getSweepSettings()).bandwidth;
        if (b !== null) store.bandwidthHz = 4000 / (b + 1);
    } catch (e) {
        log('Cannot read the IF bandwidth: ' + e);
    }
}

export function detectBestConnectionType() {
    if (import.meta.env.VITE_ESP) return 'ws'; // served by the ESP32 itself: always use its bridge
    if (new URLSearchParams(location.search).get('host')) return 'ws';
    if (store.connectionType === 'serial') return 'serial';
    if (store.connectionType === 'usb') return 'usb';
    if (store.connectionType === 'ws') return 'ws';

    // Auto
    const userAgent = navigator.userAgent || '';
    const isAndroid = /Android/i.test(userAgent);

    if (isAndroid) {
        if (navigator.usb) return 'usb';
        if (navigator.serial) return 'serial';
    } else {
        if (navigator.serial) return 'serial';
        if (navigator.usb) return 'usb';
    }
    return 'serial'; // Default fallback
}

export async function connect() {
    try {
        store.status = 'connecting';

        const type = detectBestConnectionType();
        store.connectionType = type; // Ensure store state reflects detection
        console.log('connect type:', type);

        const NanoVNA = type === 'ws' ? NanoVNA_WebSocket : type === 'usb' ? NanoVNA_WebUSB : NanoVNA_WebSerial;
        const wsUrl = 'ws://' + (store.wsHost || location.host) + '/ws';

        let device = await NanoVNA.getDevice({ url: wsUrl });
        if (!device) {
            device = await NanoVNA.requestDevice();
        }

        if (!device) {
            store.status = 'disconnected';
            return;
        }

        store.info = NanoVNA.deviceInfo(device);

        // Always get the worker for DSP operations
        const dspWorker = await getWorker();

        // Define callbacks
        // Note: logs need to be proxied to be called from worker
        // Wrap object with Comlink.proxy so the worker receives a proxy to this object
        const proxyCallbacks = Comlink.proxy({
            onerror: (e) => {
                log('Worker/Client error: ' + e);
                store.error = String(e); // Show error
            },
            ondisconnected: () => {
                log('Worker/Client disconnected');
                disconnect();
            },
            log: (msg) => {
                log(msg);
            }
        });

        await dspWorker.init(proxyCallbacks);

        if (type === 'ws') {
            log('Connecting to ' + wsUrl);
            await dspWorker.open({ type: 'ws', url: wsUrl });
        } else if (type === 'usb') {
            log('Opening WebUSB device...');
            // The worker will find the device using getDevice() since we already requested permission.
            await dspWorker.open({ type: 'usb' });
            log('WebUSB device opened');
        } else {
            // Serial
            await dspWorker.open({ type: 'serial' });
        }
        // workerProxy is already dspWorker

        if (type === 'ws') await pullFromDevice(store.wsHost);
        store.lastDataAt = Date.now();
        store.deviceFrozen = false;
        store.status = 'connected';
        store.autoUpdate = true;
        store.version = await workerProxy.getVersion();
        store.info = await workerProxy.getInfo();
        store.fwNew = null;
        refreshBandwidth();
        if (!import.meta.env.VITE_DEMO) newerFirmware(store.version, store.info).then((r) => { store.fwNew = r; });
        startUpdateLoop();
    } catch (e) {
        log('Connect function caught error: ' + e);
        console.error('Connect function caught error:', e);
        store.status = 'disconnected';
        store.error = String(e);
        // Clean up
        disconnect();
        throw e;
    }
}

export async function disconnect() {
    // whatever the update loop or a calibration was waiting for will never arrive: let go of it so that a new connection starts clean
    loopGeneration++;
    loopRunning = false;
    store.updating = false;
    if (calRun.running) {
        calRun.running = false;
        calRun.error = 'Connection to the NanoVNA lost during the measurement. Connect again and repeat this step.';
    }
    calRun.suspect = null;
    store.calibrationRunning = false;
    if (workerProxy) {
        try {
            await workerProxy.close();
        } catch (e) {
            console.error('Error closing connection:', e);
        }
    }
    appCalDeviceOff = false;
    sweepStale = true;
    workerProxy = null;
    workerInstance = null; // Also clear instance to force full re-init
    store.status = 'disconnected';
}

let loopRunning = false;
let loopGeneration = 0; // a loop that was waiting on a lost connection must not carry on beside the one of the next connection
const SWEEP_MS = 900; // a 101 point sweep of the NanoVNA-H takes about 0.6 s at the usual IF bandwidth of 1000 Hz
// measured on the NanoVNA-H: about 0.15 s + 101 / bandwidth (0.23 s at 1000 Hz, 1.15 s at 100 Hz, 10.2 s at 10 Hz); the wait grows with the narrower bandwidth
const sweepMs = () => SWEEP_MS + Math.max(0, Math.round(101000 * (1 / store.bandwidthHz - 1 / 1000)));
let lastSignature = null;
let sameReadings = 0;
let sweepStale = true; // true until a sweep has been started and completed for the current range
let appCalDeviceOff = false; // the device's own calibration has been switched off for the app-side one

export async function startUpdateLoop() {
    if (store.status !== 'connected' || loopRunning) return;
    loopRunning = true;
    const generation = ++loopGeneration;

    try {
        const worker = await getWorker();

        const updateSingleSegment = async () => {
            store.updating = true;
            try {
                const epoch = rangeEpoch;
                if (!import.meta.env.VITE_ESP || sweepStale) {
                    await worker.resume();
                    if (import.meta.env.VITE_ESP) {
                        // `resume` restarts the sweep and `data` answers at once with the old sweep for the points not measured yet:
                        // let one sweep finish, and otherwise leave the device sweeping so that all points keep being refreshed
                        await new Promise(r => setTimeout(r, sweepMs()));
                        sweepStale = false;
                    }
                }
                const freqs = await worker.getFrequencies();
                if (rangeChanging || epoch !== rangeEpoch) return; // the range is being switched: this reading is a half-way state

                // Check if frequency range changed (Original logic)
                const currentFreqs = store.frequencies.data || [];
                const changed = freqs.length !== currentFreqs.length || freqs.some((v, i) => v !== currentFreqs[i]);

                if (changed) {
                    store.data.ch0 = [];
                    store.data.ch1 = [];
                    store.frequencies.data = freqs;
                    store.frequencies.length = freqs.length; // Ensure length is updated for UI

                    // Update range from device (Original behavior)
                    if (freqs.length > 0) {
                        const start = freqs[0];
                        const stop = freqs[freqs.length - 1];
                        const span = stop - start;
                        const center = start + span / 2;

                        store.frequencies.start = start;
                        store.frequencies.stop = stop;
                        store.frequencies.span = span;
                        store.frequencies.center = center;
                    }
                }

                if (appCal.enabled && !appCalDeviceOff) {
                    await worker.doCal('off'); // the app corrects the raw readings itself
                    appCalDeviceOff = true;
                }
                const data0 = await worker.getData(0);
                const data1 = await worker.getData(1);
                if (rangeChanging || epoch !== rangeEpoch || store.calibrationRunning) return; // range switched while the data was read: it belongs to the old range
                const needsCh1 = store.traces.some(t => t.channel === 1 && t.show);

                // live readings always differ in the last digits: identical ones again and again mean the NanoVNA stopped measuring
                const signature = data0.reduce((a, d) => a + d[0] * 1.37 + d[1], 0);
                sameReadings = signature === lastSignature ? sameReadings + 1 : 0;
                lastSignature = signature;
                store.deviceFrozen = sameReadings >= 8;
                store.lastDataAt = Date.now();

                let ch0 = data0.map((d, i) => ({
                    freq: freqs[i],
                    real: d[0],
                    imag: d[1]
                }));
                if (appCal.enabled) {
                    const corrected = applyCal(ch0, appCal.bands);
                    ch0 = corrected.points;
                    store.appCalCovered = ch0.length ? corrected.covered / ch0.length : 0;
                }
                ch0 = portExtend(ch0, portDelay());
                store.data.ch0 = ch0;

                if (needsCh1) {
                    store.data.ch1 = data1.map((d, i) => ({
                        freq: freqs[i],
                        real: d[0],
                        imag: d[1]
                    }));
                }

                store.dataVersion++;
            } finally {
                store.updating = false;
            }
        };

        const updateMultiSegments = async () => {
            store.updating = true;
            store.requestStop = false;
            try {
                const start = +store.frequencies.start;
                const stop = +store.frequencies.stop;
                const segments = +store.frequencies.segments;
                const segmentSize = 101;
                const totalPoints = segmentSize * segments;
                const step = (stop - start) / (totalPoints - 1);

                // Update length so UI knows we are in multi-segment mode
                store.frequencies.length = totalPoints;

                store.progress.total = segments;
                store.progress.value = 0;

                let currentCh0 = store.data.ch0.length ? [...store.data.ch0] : [];
                let currentCh1 = store.data.ch1.length ? [...store.data.ch1] : [];

                for (let i = 0, n = 0; i < segments; i++) {
                    // Check stop request (Fix for Stop button)
                    if (store.requestStop || store.status !== 'connected') break;
                    // Note: original code checks segments again, but simplified here as segments is unlikely to change mid-loop without reset
                    if (+store.frequencies.segments === 1) break;

                    store.progress.value = i + 1;

                    const segmentStart = start + step * n;
                    const segmentStop = stop - (step * (segments - 1)) + step * n;

                    await worker.scan(segmentStart, segmentStop, segmentSize);

                    const data0 = await worker.getData(0);
                    const data1 = await worker.getData(1);

                    const segmentStep = (segmentStop - segmentStart) / (segmentSize - 1);

                    const segmentFreqs = new Uint32Array(segmentSize);
                    for (let k = 0; k < segmentSize; k++) {
                        segmentFreqs[k] = segmentStep * k + segmentStart;
                    }

                    const segFreqsSet = new Set(segmentFreqs);

                    const merge = (current, incoming) => {
                        const filtered = current.filter(p => !segFreqsSet.has(p.freq));
                        const newPoints = incoming.map((d, k) => ({
                            freq: segmentFreqs[k],
                            real: d[0],
                            imag: d[1]
                        }));
                        return filtered.concat(newPoints).sort((a, b) => a.freq - b.freq);
                    };

                    currentCh0 = merge(currentCh0, data0);
                    currentCh1 = merge(currentCh1, data1);

                    store.data.ch0 = currentCh0;
                    store.data.ch1 = currentCh1;

                    store.frequencies.data = currentCh0.map(p => p.freq);

                    store.dataVersion++;

                    n = i % 2 === 0 ? n + segments - i - 1 : n - (segments - i - 1);
                }
            } finally {
                store.updating = false;
            }
        };

        // Multi view: one sweep per selected band, each corrected with that band's calibration
        const updateMultiBands = async () => {
            store.updating = true;
            try {
                const worker = workerProxy || await getWorker();
                if (appCal.enabled && !appCalDeviceOff) {
                    await worker.doCal('off');
                    appCalDeviceOff = true;
                }
                for (const name of [...store.multiBands]) {
                    if (!store.multiActive || store.status !== 'connected' || store.calibrationRunning || !store.autoUpdate) break;
                    const band = HAM_BANDS.find(b => b.name === name);
                    if (!band) continue;
                    const { start, stop } = bandSweep(band);
                    const { freqs, ch0: data0 } = await readSweep(worker, start, stop);
                    if (!store.multiActive || store.calibrationRunning) break;
                    let points = data0.map((d, i) => ({ freq: freqs[i], real: d[0], imag: d[1] }));
                    const cal = appCal.enabled ? appCal.bands[name] : null;
                    if (cal) points = applyCal(points, { [name]: cal }).points;
                    points = portExtend(points, portDelay());
                    store.multi[name] = { points, calibrated: !!cal, at: Date.now() };
                    store.lastDataAt = Date.now();
                    store.dataVersion++;
                }
            } finally {
                store.updating = false;
            }
        };

        // Cable and TDR views: the raw reflection of a cable over one wide sweep (the view's own preset)
        const updateCable = async () => {
            store.updating = true;
            try {
                const worker = workerProxy || await getWorker();
                const r = store.tdrActive ? TDR_RANGES[store.tdrPreset] : CABLE_RANGES[store.cablePreset];
                const { freqs, ch0: data0 } = await readSweep(worker, r.start, r.stop);
                if (!(store.cableActive || store.tdrActive) || store.calibrationRunning) return;
                store.cable = { points: data0.map((d, i) => ({ freq: freqs[i], real: d[0], imag: d[1] })), at: Date.now() };
                store.lastDataAt = Date.now();
                store.dataVersion++;
            } finally {
                store.updating = false;
            }
        };

        let wasMulti = false;
        while (store.status === 'connected' && generation === loopGeneration) {
            if (wasMulti && !store.multiActive && !store.cableActive && !store.tdrActive && !store.calibrationRunning) {
                // the other views expect the device on the range of the store
                wasMulti = false;
                try {
                    await setRange(worker, +store.frequencies.start, +store.frequencies.stop);
                } catch (e) { /* the range is re-applied on the next change anyway */ }
                rangeEpoch++;
                sweepStale = true;
            }
            if (store.multiActive && store.autoUpdate && !store.updating && !store.calibrationRunning) {
                wasMulti = true;
                await updateMultiBands();
            } else if ((store.cableActive || store.tdrActive) && store.autoUpdate && !store.updating && !store.calibrationRunning) {
                wasMulti = true;
                await updateCable();
            } else if (!store.multiActive && !store.cableActive && !store.tdrActive && store.autoUpdate && !store.updating && !store.calibrationRunning) {
                const segments = +store.frequencies.segments;
                const versionBefore = store.dataVersion;
                if (segments === 1) {
                    await updateSingleSegment();
                } else {
                    await updateMultiSegments();
                }
                // paused with a changed range: stop again once a sweep has actually delivered data (readings of a half-switched range are discarded)
                if (store.sweepOnce && store.dataVersion !== versionBefore) { store.sweepOnce = false; store.autoUpdate = false; }
            }
            if (store.requestStop) {
                store.autoUpdate = false;
                store.requestStop = false;
            }
            await new Promise(r => setTimeout(r, 100));
        }
    } finally {
        if (generation === loopGeneration) {
            loopRunning = false;
            store.updating = false;
        }
    }
}

// Watch frequency changes
let rangeEpoch = 0; // bumped whenever the range is switched, so readings that straddle a switch can be discarded
let rangeChanging = false; // while true the update loop must not copy the device's (half changed) range into the store
watch(() => [store.frequencies.start, store.frequencies.stop, store.frequencies.segments], async ([start, stop, segments], [oldStart, oldStop]) => {
    if (store.status === 'connected' && workerProxy) {
        if (+segments === 1) {
            const moved = +start !== +oldStart || +stop !== +oldStop;
            rangeChanging = true;
            if (moved) { rangeEpoch++; sweepStale = true; }
            try {
                // In single segment mode, we must update device registers immediately
                // so that the next resume() call uses the new range. The device drags `stop` along when `start` is set
                // above it, so move the end that keeps the range valid first.
                if (+start > +oldStop) {
                    await workerProxy.setSweep('stop', +stop);
                    await workerProxy.setSweep('start', +start);
                } else {
                    await workerProxy.setSweep('start', +start);
                    await workerProxy.setSweep('stop', +stop);
                }
            } catch (e) {
                console.error('Failed to update frequency range', e);
            } finally {
                if (moved) { rangeEpoch++; sweepStale = true; }
                rangeChanging = false;
            }
        }
    }
});

export async function calibration(step, slot = 0) {
    if (!workerProxy) return;
    store.calibrationRunning = true;
    try {
        await workerProxy.doCal(step, slot);
    } finally {
        store.calibrationRunning = false;
    }
}

// ---- app-side open/short/load calibration over all ham bands ----

export const CAL_STEPS = ['open', 'short', 'load'];
// guided: the step-by-step calibration is open, next: index in CAL_STEPS of the standard to measure now (3 = all done),
// suspect: a measurement that does not look like the standard asked for, held back until the user decides
export const calRun = reactive({ running: false, step: '', band: '', done: 0, total: HAM_BANDS.length, error: '', guided: false, next: 0, suspect: null });

// One whole sweep of 101 points from start to stop: { freqs, ch0, ch1 } (ch1 only with withCh1). `scan_bin` answers once the
// sweep is done, so there is no waiting and no half old, half new reading; a firmware without it gets the plain sequence.
let scanBinOk = true;
async function readSweep(worker, start, stop, withCh1 = false) {
    if (scanBinOk) {
        try {
            return await worker.scanBin(Math.round(start), Math.round(stop), 101, withCh1 ? 7 : 3);
        } catch (e) {
            if (!e || !e.unsupported) throw e;
            scanBinOk = false;
        }
    }
    await setRange(worker, start, stop);
    await worker.resume();
    await new Promise(r => setTimeout(r, sweepMs())); // `data` does not wait for the sweep to finish
    const freqs = await worker.getFrequencies();
    return { freqs, ch0: await worker.getData(0), ch1: withCh1 ? await worker.getData(1) : [] };
}

// sets the device sweep without ever passing through start > stop (the device drags the other end along)
async function setRange(worker, start, stop) {
    await worker.setSweep('start', 50000);
    await worker.setSweep('stop', Math.round(stop));
    await worker.setSweep('start', Math.round(start));
}

async function measureRaw(worker, start, stop) {
    const a = await readSweep(worker, start, stop);
    const b = await readSweep(worker, start, stop);
    return { freqs: a.freqs, data: a.ch0.map((d, i) => [(d[0] + b.ch0[i][0]) / 2, (d[1] + b.ch0[i][1]) / 2]) };
}

const dataOf = (measured) => Object.fromEntries(Object.entries(measured).map(([name, m]) => [name, m.data]));

// stores a measured standard ({ band: { freqs, data } }); once a band has all three its correction is computed
async function commitStandard(step, measured) {
    for (const [name, m] of Object.entries(measured)) {
        const raw = appCal.raw[name] || (appCal.raw[name] = {});
        raw.freqs = m.freqs;
        raw[step] = m.data;
        if (raw.open && raw.short && raw.load) {
            appCal.bands[name] = { freqs: raw.freqs, ...solveOSL(raw.open, raw.short, raw.load) };
            delete appCal.raw[name];
        }
    }
    appCal.enabled = Object.keys(appCal.bands).length > 0;
    if (calRun.guided) calRun.next = CAL_STEPS.indexOf(step) + 1;
    await pushToDevice(store.wsHost);
}

// measures one standard ('open' | 'short' | 'load') on every band; a result that does not look like the standard is held in
// calRun.suspect until appCalAccept() or appCalDiscard()
export async function appCalMeasure(step) {
    if (store.status !== 'connected' || calRun.running) return;
    calRun.running = true;
    calRun.step = step;
    calRun.error = '';
    calRun.suspect = null;
    calRun.done = 0;
    store.calibrationRunning = true;
    const restore = { start: +store.frequencies.start, stop: +store.frequencies.stop };
    try {
        while (store.updating) await new Promise(r => setTimeout(r, 50));
        const worker = await getWorker();
        await worker.doCal('off');
        appCalDeviceOff = true;
        const measured = {};
        for (const band of HAM_BANDS) {
            calRun.band = band.name;
            const { start, stop } = bandSweep(band);
            measured[band.name] = await measureRaw(worker, start, stop);
            calRun.done++;
        }
        const before = (what) => Object.fromEntries(HAM_BANDS.filter(b => appCal.raw[b.name]?.[what]).map(b => [b.name, appCal.raw[b.name][what]]));
        const problem = checkStandard(step, dataOf(measured), { open: before('open'), short: before('short') });
        if (problem) calRun.suspect = { step, problem, measured };
        else await commitStandard(step, measured);
    } catch (e) {
        calRun.error = String(e);
        log('App calibration failed: ' + e);
    } finally {
        try {
            const worker = await getWorker();
            await setRange(worker, restore.start, restore.stop);
        } catch (e) { /* the range is re-applied on the next change anyway */ }
        rangeEpoch++;
        sweepStale = true;
        store.calibrationRunning = false;
        calRun.running = false;
    }
}

// keeps the held-back measurement anyway
export async function appCalAccept() {
    const s = calRun.suspect;
    if (!s) return;
    calRun.suspect = null;
    try {
        await commitStandard(s.step, s.measured);
    } catch (e) {
        calRun.error = String(e);
    }
}

export function appCalDiscard() {
    calRun.suspect = null;
}

// guided calibration: starts over with the standards (a finished calibration stays until a new one is complete)
export function appCalStart() {
    appCal.raw = {};
    calRun.guided = true;
    calRun.next = 0;
    calRun.suspect = null;
    calRun.error = '';
}

export function appCalBack() {
    calRun.next = Math.max(0, calRun.next - 1);
    calRun.suspect = null;
}

export function appCalClose() {
    if (calRun.next < CAL_STEPS.length) appCal.raw = {}; // standards measured so far must not mix with a later run
    calRun.guided = false;
    calRun.suspect = null;
}

export function appCalReset() {
    appCal.enabled = false;
    appCal.bands = {};
    appCal.raw = {};
    pushToDevice(store.wsHost);
}
