// Minimal in-memory IndexedDB shim, just enough for app/analytics-recorder.js (no packages needed).
// Supports: open + onupgradeneeded, createObjectStore({keyPath}), createIndex, transaction(names, mode),
// store put/get/getAll/delete/clear/openCursor(range|null, "next"|"prev"), index getAll/openCursor, IDBKeyRange.
// Transactions are atomic: a failed request aborts the tx and the stores roll back.
function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
const IDBKeyRange = {
  only: (v) => ({ lo: v, hi: v, loOpen: false, hiOpen: false }),
  lowerBound: (v, open = false) => ({ lo: v, hi: undefined, loOpen: open, hiOpen: false }),
  upperBound: (v, open = false) => ({ lo: undefined, hi: v, loOpen: false, hiOpen: open }),
  bound: (lo, hi, loOpen = false, hiOpen = false) => ({ lo, hi, loOpen, hiOpen }),
};
function inRange(range, key) {
  if (range == null) return true;
  if (typeof range !== "object" || !("loOpen" in range)) return cmp(key, range) === 0;
  if (range.lo !== undefined) { const c = cmp(key, range.lo); if (c < 0 || (c === 0 && range.loOpen)) return false; }
  if (range.hi !== undefined) { const c = cmp(key, range.hi); if (c > 0 || (c === 0 && range.hiOpen)) return false; }
  return true;
}

function makeFactory(opts = {}) {
  const dbs = new Map(); // name -> { version, schema:{store:{keyPath, indexes:{name:keyPath}}}, data:{store:Map} }
  const stats = { puts: 0, deletes: 0, txs: 0, maxIndexGetAll: 0 };
  const control = { failPuts: false, failOpen: false, failStore: null, stats };

  class Request { constructor() { this.result = undefined; this.error = null; this.onsuccess = null; this.onerror = null; } }

  function makeTx(db, names, mode) {
    stats.txs++;
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null, mode };
    let pending = 0, snapshot = null, aborted = false, doneFired = false;
    const check = () => {
      setTimeout(() => {
        if (pending === 0 && !aborted && !doneFired) { doneFired = true; tx.oncomplete && tx.oncomplete(); }
      }, 0);
    };
    const abort = (err) => {
      if (aborted) return;
      aborted = true; tx.error = err;
      if (snapshot) for (const [n, m] of Object.entries(snapshot)) db.data[n] = m;
      setTimeout(() => { tx.onabort && tx.onabort(); }, 0);
    };
    const run = (fn, write) => {
      const rq = new Request();
      pending++;
      setTimeout(() => {
        if (aborted) return;
        try {
          if (write) {
            if (mode !== "readwrite") throw new Error("ReadOnlyError");
            if (!snapshot) { snapshot = {}; for (const [n, m] of Object.entries(db.data)) snapshot[n] = new Map(m); }
            if (control.failPuts && write === "put") throw new Error("injected put failure");
          }
          rq.result = fn();
        } catch (e) {
          rq.error = e; pending--;
          if (rq.onerror) rq.onerror();
          abort(e);
          return;
        }
        pending--;
        if (rq.onsuccess) rq.onsuccess();
        check();
      }, 0);
      return rq;
    };
    const storeApi = (name) => {
      const sch = db.schema[name];
      const data = () => db.data[name];
      const keyOf = (v) => v[sch.keyPath];
      const sorted = (idx) => {
        const rows = [...data().values()];
        if (idx) rows.sort((a, b) => cmp(a[sch.indexes[idx]], b[sch.indexes[idx]]) || cmp(keyOf(a), keyOf(b)));
        else rows.sort((a, b) => cmp(keyOf(a), keyOf(b)));
        return rows;
      };
      const query = (idx, range) => sorted(idx).filter((r) => inRange(range, idx ? r[sch.indexes[idx]] : keyOf(r)));
      const cursorOf = (idx) => (range, dir = "next") => {
        const rq = new Request();
        let rows = null, i = 0;
        const step = () => {
          pending++;
          setTimeout(() => {
            if (aborted) return;
            if (rows === null) { rows = query(idx, range); if (dir === "prev") rows.reverse(); }
            pending--;
            if (i >= rows.length) rq.result = null;
            else {
              const value = structuredClone(rows[i++]);
              rq.result = { value, continue: () => step() };
            }
            rq.onsuccess && rq.onsuccess();
            check();
          }, 0);
        };
        step();
        return rq;
      };
      const index = (idx) => ({
        getAll: (range, count) => run(() => { const out = structuredClone(query(idx, range)).slice(0, count > 0 ? count : undefined); stats.maxIndexGetAll = Math.max(stats.maxIndexGetAll, out.length); return out; }),
        openCursor: cursorOf(idx),
      });
      return {
        put: (v) => run(() => { stats.puts++; data().set(keyOf(v), structuredClone(v)); return keyOf(v); }, "put"),
        get: (k) => run(() => { const v = data().get(k); return v === undefined ? undefined : structuredClone(v); }),
        getAll: (range) => run(() => structuredClone(query(null, range))),
        delete: (k) => run(() => { stats.deletes++; data().delete(k); }, "delete"),
        clear: () => run(() => { data().clear(); }, "clear"),
        openCursor: cursorOf(null),
        index,
      };
    };
    tx.objectStore = (name) => { if (!names.includes(name)) throw new Error("NotFoundError"); return storeApi(name); };
    check();
    return tx;
  }

  return {
    control,
    open(name, version) {
      const rq = new Request();
      rq.onupgradeneeded = null;
      setTimeout(() => {
        if (control.failOpen) { rq.error = new Error("injected open failure"); rq.onerror && rq.onerror(); return; }
        let rec = dbs.get(name);
        const fresh = !rec || rec.version < version;
        if (!rec) { rec = { version: 0, schema: {}, data: {} }; dbs.set(name, rec); }
        const db = {
          objectStoreNames: { contains: (n) => n in rec.schema },
          createObjectStore(n, { keyPath }) {
            rec.schema[n] = { keyPath, indexes: {} }; rec.data[n] = new Map();
            return { createIndex(i, kp) { rec.schema[n].indexes[i] = kp; } };
          },
          transaction: (names, mode = "readonly") => makeTx(rec, Array.isArray(names) ? names : [names], mode),
          close() {}, onversionchange: null,
        };
        rq.result = db;
        if (fresh) { rec.version = version; rq.onupgradeneeded && rq.onupgradeneeded(); }
        rq.onsuccess && rq.onsuccess();
      }, 0);
      return rq;
    },
    // test peeks
    peek(name, store) { const rec = dbs.get(name); return rec ? [...rec.data[store].values()] : []; },
  };
}

module.exports = { makeFactory, IDBKeyRange };
