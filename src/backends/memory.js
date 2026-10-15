/*!
 * canvas-comments-kit — in-memory realtime backend.
 *
 * Nothing persists; every subscriber on the same backend sees changes live. Use it for
 * demos, tests, storybook-style fixtures, or as a reference when writing a realtime
 * backend of your own.
 */
const resolve = c => (typeof c === 'function' ? c() : c);
const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));

/**
 * @param {object} [opts]
 * @param {string|(()=>string)} [opts.context]  bind a context; omitted → use the one the overlay passes
 * @param {Object<string, Thread[]>} [opts.threads]  seed data, keyed by context
 * @param {number} [opts.latency=0]  artificial delay (ms) on every call, to exercise async UI
 * @returns {{ store, dump(): Object<string, Thread[]> }}
 */
export function memoryBackend({ context, threads = {}, latency = 0 } = {}) {
  const data = new Map(Object.entries(clone(threads)));
  const subs = new Set(), countSubs = new Set();
  const ctxOf = arg => (context != null ? resolve(context) : arg);
  const all = c => { if (!data.has(c)) data.set(c, []); return data.get(c); };
  const wait = () => (latency ? new Promise(r => setTimeout(r, latency)) : Promise.resolve());
  const counts = p => {
    const m = {};
    for (const [c, a] of data) {
      if (c.indexOf(p) !== 0) continue;
      const revs = a.filter(t => !t.resolved).map(t => (t.rev == null ? null : t.rev));
      if (revs.length) m[c] = revs;
    }
    return m;
  };
  function changed(c) {
    subs.forEach(s => { if (s.context === c) s.cb(clone(all(c))); });
    countSubs.forEach(s => s.cb(counts(s.prefix)));
  }
  const find = (c, id) => all(c).find(t => t.id === id);

  const store = {
    async list(c) { await wait(); return clone(all(ctxOf(c))); },
    async addThread(t, c) { await wait(); const k = ctxOf(c); all(k).push(clone(t)); changed(k); return t; },
    async addReply(id, m, c) { await wait(); const k = ctxOf(c), t = find(k, id); if (t) { t.messages.push(clone(m)); changed(k); } return m; },
    async update(id, p, c) { await wait(); const k = ctxOf(c), t = find(k, id); if (t) { Object.assign(t, clone(p)); changed(k); } },
    async remove(id, c) { await wait(); const k = ctxOf(c); data.set(k, all(k).filter(t => t.id !== id)); changed(k); },
    subscribe(cb, c) {
      const s = { context: ctxOf(c), cb }; subs.add(s); cb(clone(all(s.context)));
      return () => subs.delete(s);
    },
    countFor: c => all(c).filter(t => !t.resolved).length,
    countsByContext(p, cb) {
      const s = { prefix: p, cb }; countSubs.add(s); cb(counts(p));
      return () => countSubs.delete(s);
    },
  };
  return { store, dump: () => clone(Object.fromEntries(data)) };
}

export default memoryBackend;
