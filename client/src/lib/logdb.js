// The single-frequency log in IndexedDB (one record). It survives a reload and a discarded tab; the browser deletes it with
// "clear site data", in a private window and under storage pressure. Everything resolves (never rejects): without IndexedDB
// the log simply stays in memory.
const DB = 'nanovna-log';
const STORE = 'log';
const KEY = 'single';

const open = () => new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
});

async function run(mode, action) {
    const db = await open();
    if (!db) return { ok: false, value: null };
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE, mode);
            const req = action(tx.objectStore(STORE));
            tx.oncomplete = () => { db.close(); resolve({ ok: true, value: req && req.result !== undefined ? req.result : null }); };
            tx.onerror = tx.onabort = () => { db.close(); resolve({ ok: false, value: null }); };
        } catch (e) {
            db.close();
            resolve({ ok: false, value: null });
        }
    });
}

// the saved record { startedAt, intervalMs, cols } or null
export async function loadLog() {
    return (await run('readonly', s => s.get(KEY))).value;
}

// true when the record was stored
export async function saveLog(record) {
    return (await run('readwrite', s => s.put(record, KEY))).ok;
}

export async function clearLog() {
    return (await run('readwrite', s => s.delete(KEY))).ok;
}
