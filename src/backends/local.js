/*!
 * canvas-comments-kit — localStorage backend (the overlay's default).
 *
 * Threads for a context live as a JSON array under `<prefix><context>` (default
 * `xcomments:`). Per-browser only; right for prototypes, offline drafts, and local-first
 * flows (comment locally, migrate to a cloud backend on save).
 */
const resolve = c => (typeof c === 'function' ? c() : c);

/**
 * @param {object} [opts]
 * @param {string|(()=>string)} [opts.context]  bind a context; omitted → use the one the overlay passes
 * @param {string} [opts.prefix='xcomments:']   localStorage key prefix
 * @returns {{ store }}
 */
export function localStorageBackend({ context, prefix = 'xcomments:' } = {}) {
  const ctxOf = arg => (context != null ? resolve(context) : arg);
  const keyOf = c => prefix + c;
  const read = c => { try { return JSON.parse(localStorage.getItem(keyOf(c)) || '[]'); } catch (e) { return []; } };
  const write = (c, a) => { try { localStorage.setItem(keyOf(c), JSON.stringify(a)); } catch (e) { } notifyCounts(); };

  // Every unresolved thread whose context starts with `p`, as { context: [rev|null, …] }.
  function scan(p) {
    const m = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(prefix + p) !== 0) continue;
        const arr = JSON.parse(localStorage.getItem(k) || '[]').filter(t => !t.resolved).map(t => (t.rev == null ? null : t.rev));
        if (arr.length) m[k.slice(prefix.length)] = arr;
      }
    } catch (e) { }
    return m;
  }
  const countWatchers = new Set();
  function notifyCounts() { countWatchers.forEach(w => w.cb(scan(w.prefix))); }

  const store = {
    list: async c => read(ctxOf(c)),
    addThread: async (t, c) => { const k = ctxOf(c), a = read(k); a.push(t); write(k, a); return t; },
    addReply: async (id, m, c) => { const k = ctxOf(c), a = read(k), t = a.find(x => x.id === id); if (t) { t.messages.push(m); write(k, a); } return m; },
    update: async (id, p, c) => { const k = ctxOf(c), a = read(k), t = a.find(x => x.id === id); if (t) { Object.assign(t, p); write(k, a); } },
    remove: async (id, c) => { const k = ctxOf(c); write(k, read(k).filter(x => x.id !== id)); },
    // sync count of UNRESOLVED threads for an arbitrary context (for per-page badges)
    countFor: c => read(c).filter(t => !t.resolved).length,
    // fires now, then after every write made through this store
    countsByContext(p, cb) {
      const w = { prefix: p, cb }; countWatchers.add(w); cb(scan(p));
      return () => countWatchers.delete(w);
    },
  };
  return { store };
}

// Back-compat: the bare store, bound to a context (the pre-kit `makeLocalStore(ctx)`).
export function makeLocalStore(context, opts) { return localStorageBackend({ ...opts, context }).store; }

export default localStorageBackend;
