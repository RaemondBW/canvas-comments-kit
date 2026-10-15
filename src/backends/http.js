/*!
 * canvas-comments-kit — generic HTTP/REST backend.
 *
 * Talks JSON to any server that implements these routes (relative to `baseUrl`):
 *
 *   GET    /threads?context=<ctx>          -> Thread[]
 *   POST   /threads                        body: Thread & { context }  -> Thread (may assign `id`)
 *   POST   /threads/:id/messages           body: Message & { context } -> Message
 *   PATCH  /threads/:id                    body: patch & { context }   -> any
 *   DELETE /threads/:id?context=<ctx>      -> any
 *   GET    /counts?prefix=<p>              -> { [context]: (rev|null)[] }   (only with `counts: true`)
 *
 * Rename any route with `routes`. Auth is yours: pass `headers` (object or async fn,
 * e.g. a bearer token from your identity provider) or a custom `fetch`. With `poll`
 * set, the store gains a polling `subscribe()` so other people's comments appear
 * without a reload; leave it unset for pull-only behavior.
 */
const resolve = c => (typeof c === 'function' ? c() : c);

const DEFAULT_ROUTES = {
  list: ctx => ({ method: 'GET', path: `/threads?context=${encodeURIComponent(ctx)}` }),
  addThread: () => ({ method: 'POST', path: '/threads' }),
  addReply: id => ({ method: 'POST', path: `/threads/${encodeURIComponent(id)}/messages` }),
  update: id => ({ method: 'PATCH', path: `/threads/${encodeURIComponent(id)}` }),
  remove: (id, ctx) => ({ method: 'DELETE', path: `/threads/${encodeURIComponent(id)}?context=${encodeURIComponent(ctx)}` }),
  counts: prefix => ({ method: 'GET', path: `/counts?prefix=${encodeURIComponent(prefix)}` }),
};

/**
 * @param {object} opts
 * @param {string} opts.baseUrl                     e.g. 'https://api.example.com/comments'
 * @param {string|(()=>string)} [opts.context]      bind a context; omitted → use the one the overlay passes
 * @param {object|(()=>object|Promise<object>)} [opts.headers]  extra request headers
 * @param {typeof fetch} [opts.fetch]               custom fetch (defaults to globalThis.fetch)
 * @param {number} [opts.poll]                      ms between polls; enables subscribe()
 * @param {boolean} [opts.counts]                   server implements GET /counts (enables countsByContext)
 * @param {object} [opts.routes]                    override any of DEFAULT_ROUTES
 * @returns {{ store, request }}
 */
export function httpBackend({ baseUrl, context, headers, fetch: fetchImpl, poll, counts, routes } = {}) {
  if (!baseUrl) throw new TypeError('httpBackend: baseUrl is required');
  const base = baseUrl.replace(/\/+$/, '');
  const r = { ...DEFAULT_ROUTES, ...routes };
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new TypeError('httpBackend: no fetch available; pass opts.fetch');
  const ctxOf = arg => (context != null ? resolve(context) : arg);

  async function request({ method, path }, body) {
    const h = { Accept: 'application/json', ...(typeof headers === 'function' ? await headers() : headers) };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await doFetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) {
      const e = new Error(`${method} ${path} failed: ${res.status}`);
      e.status = res.status;
      throw e;
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  const store = {
    list: async c => (await request(r.list(ctxOf(c)))) || [],
    addThread: async (t, c) => (await request(r.addThread(ctxOf(c)), { ...t, context: ctxOf(c) })) || t,
    addReply: async (id, m, c) => (await request(r.addReply(id, ctxOf(c)), { ...m, context: ctxOf(c) })) || m,
    update: async (id, p, c) => { await request(r.update(id, ctxOf(c)), { ...p, context: ctxOf(c) }); },
    remove: async (id, c) => { await request(r.remove(id, ctxOf(c))); },
  };

  if (poll) {
    store.subscribe = (cb, c) => {
      const k = ctxOf(c);
      let live = true, last = null;
      const tick = async () => {
        try {
          const list = (await request(r.list(k))) || [];
          const s = JSON.stringify(list);
          if (live && s !== last) { last = s; cb(list); }
        } catch (e) { console.warn('[canvas-comments-kit] http poll failed:', e && e.message); }
      };
      tick();
      const timer = setInterval(tick, poll);
      return () => { live = false; clearInterval(timer); };
    };
  }

  if (counts) {
    store.countsByContext = (prefix, cb) => {
      let live = true;
      const tick = () => request(r.counts(prefix)).then(m => { if (live) cb(m || {}); },
        e => console.warn('[canvas-comments-kit] http counts failed:', e && e.message));
      tick();
      const timer = poll ? setInterval(tick, poll) : null;
      return () => { live = false; if (timer) clearInterval(timer); };
    };
  }

  return { store, request };
}

export default httpBackend;
