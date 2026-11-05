import { reactive } from 'vue';

// Keeps the screen on through the Screen Wake Lock API. Browsers offer it on secure pages only (HTTPS or localhost): the page of
// the device is served over plain HTTP, so there it is usually missing and `supported` is false. No workaround is built in.
export const awake = reactive({
    supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    active: false, // the lock is held right now
    error: '', // why the last request failed
});

let wanted = false;
let sentinel = null;
let requesting = false;

async function acquire() {
    if (!wanted || !awake.supported || sentinel || requesting || document.visibilityState !== 'visible') return;
    requesting = true;
    try {
        const s = await navigator.wakeLock.request('screen');
        if (!wanted) { s.release().catch(() => { }); return; } // switched off while the request was on its way
        sentinel = s;
        awake.active = true;
        awake.error = '';
        s.addEventListener('release', () => {
            if (sentinel === s) { sentinel = null; awake.active = false; }
        });
    } catch (e) {
        awake.error = e && e.message ? e.message : String(e); // e.g. low battery
    } finally {
        requesting = false;
    }
}

// the browser drops the lock whenever the page is hidden: ask again when it is back
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
}

export function setKeepAwake(on) {
    wanted = !!on;
    if (!wanted) awake.error = '';
    if (wanted) acquire();
    else if (sentinel) {
        const s = sentinel;
        sentinel = null;
        awake.active = false;
        s.release().catch(() => { });
    }
}
