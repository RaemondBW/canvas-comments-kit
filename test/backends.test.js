import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineBackend, localStorageBackend, makeLocalStore, memoryBackend, httpBackend } from '../src/index.js';
import { checkStore } from '../src/testing.js';
import { cssFromSource } from '../scripts/build-css.mjs';

// Minimal Web Storage shim for Node.
function installLocalStorage() {
  const m = new Map();
  globalThis.localStorage = {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
}

// An in-process server implementing the httpBackend REST contract.
function fakeServer() {
  const db = {};
  const calls = [];
  const json = (status, body) => ({
    ok: status >= 200 && status < 300, status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  });
  const fetch = async (url, { method, headers, body }) => {
    calls.push({ method, url, headers });
    const u = new URL(url);
    const parts = u.pathname.replace(/^\/api/, '').split('/').filter(Boolean);
    const data = body ? JSON.parse(body) : undefined;
    const ctx = data?.context ?? u.searchParams.get('context');
    const list = c => (db[c] ||= []);
    if (parts[0] === 'counts') {
      const p = u.searchParams.get('prefix'), m = {};
      for (const [c, a] of Object.entries(db)) if (c.startsWith(p)) { const r = a.filter(t => !t.resolved).map(t => t.rev ?? null); if (r.length) m[c] = r; }
      return json(200, m);
    }
    if (parts[0] !== 'threads') return json(404);
    if (method === 'GET') return json(200, list(ctx));
    if (method === 'POST' && parts.length === 1) {
      const { context, ...t } = data;
      const saved = { ...t, id: 'srv-' + t.id };   // server assigns its own id
      list(context).push(saved);
      return json(201, saved);
    }
    const t = list(ctx).find(x => x.id === decodeURIComponent(parts[1]));
    if (!t) return json(404);
    if (method === 'POST' && parts[2] === 'messages') { const { context, ...m } = data; t.messages.push(m); return json(201, m); }
    if (method === 'PATCH') { const { context, ...p } = data; Object.assign(t, p); return json(204); }
    if (method === 'DELETE') { db[ctx] = list(ctx).filter(x => x !== t); return json(204); }
    return json(405);
  };
  return { fetch, db, calls };
}

const assertContract = report => assert.ok(report.ok, JSON.stringify(report.results.filter(r => !r.ok), null, 2));

test('memoryBackend passes the store contract (incl. realtime)', async () => {
  assertContract(await checkStore(memoryBackend().store));
});

test('memoryBackend with latency passes the store contract', async () => {
  assertContract(await checkStore(memoryBackend({ latency: 5 }).store));
});

test('localStorageBackend passes the store contract', async () => {
  installLocalStorage();
  assertContract(await checkStore(localStorageBackend().store));
});

test('httpBackend passes the store contract (server-assigned ids, polling)', async () => {
  const srv = fakeServer();
  const { store } = httpBackend({ baseUrl: 'https://x.test/api/', fetch: srv.fetch, poll: 10, headers: async () => ({ Authorization: 'Bearer t' }) });
  assertContract(await checkStore(store));
  assert.ok(srv.calls.every(c => c.headers.Authorization === 'Bearer t'), 'auth header sent on every call');
  assert.ok(srv.calls.every(c => c.url.startsWith('https://x.test/api/threads') ), 'trailing slash on baseUrl normalised');
});

test('httpBackend surfaces HTTP errors with a status', async () => {
  const { store } = httpBackend({ baseUrl: 'https://x.test', fetch: async () => ({ ok: false, status: 403, text: async () => '' }) });
  await assert.rejects(store.list('c'), e => e.status === 403);
});

test('httpBackend countsByContext reads /counts', async () => {
  const srv = fakeServer();
  const { store } = httpBackend({ baseUrl: 'https://x.test/api', fetch: srv.fetch, counts: true });
  await store.addThread({ id: 'a', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [], rev: 2 }, 'doc:1');
  await store.addThread({ id: 'b', anchor: { kind: 'p', x: 0, y: 0 }, resolved: true, ts: 1, messages: [] }, 'doc:2');
  const counts = await new Promise(res => { const off = store.countsByContext('doc:', m => { off?.(); res(m); }); });
  assert.deepEqual(counts, { 'doc:1': [2] });
});

test('stores use the overlay-supplied context unless they bind their own', async () => {
  const free = memoryBackend();
  await free.store.addThread({ id: 't1', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [] }, 'a');
  assert.equal((await free.store.list('a')).length, 1);
  assert.equal((await free.store.list('b')).length, 0);

  const bound = memoryBackend({ context: () => 'fixed' });
  await bound.store.addThread({ id: 't2', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [] }, 'ignored');
  assert.deepEqual(Object.keys(bound.dump()), ['fixed']);
});

test('memoryBackend does not leak references to stored threads', async () => {
  const { store } = memoryBackend();
  const t = { id: 'x', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [] };
  await store.addThread(t, 'c');
  (await store.list('c'))[0].resolved = true;
  t.messages.push({ id: 'm', author: 'a', text: 't', ts: 1 });
  const [stored] = await store.list('c');
  assert.equal(stored.resolved, false);
  assert.equal(stored.messages.length, 0);
});

test('local countsByContext re-fires after writes', async () => {
  installLocalStorage();
  const { store } = localStorageBackend();
  const seen = [];
  const off = store.countsByContext('sheet:', m => seen.push(m));
  await store.addThread({ id: 'a', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [], rev: 3 }, 'sheet:1');
  await store.update('a', { resolved: true }, 'sheet:1');
  off();
  await store.addThread({ id: 'b', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [] }, 'sheet:1');
  assert.deepEqual(seen, [{}, { 'sheet:1': [3] }, {}]);
  assert.equal(store.countFor('sheet:1'), 1);
});

test('makeLocalStore keeps the pre-kit key layout', async () => {
  installLocalStorage();
  const s = makeLocalStore('doc-7');
  await s.addThread({ id: 'a', anchor: { kind: 'p', x: 0, y: 0 }, resolved: false, ts: 1, messages: [] });
  assert.equal(JSON.parse(localStorage.getItem('xcomments:doc-7')).length, 1);
});

test('defineBackend validates each part and reports capabilities', () => {
  assert.throws(() => defineBackend({ store: { list() {} } }), /store is missing method\(s\): addThread, addReply, update, remove/);
  assert.throws(() => defineBackend({ identity: {} }), /identity is missing method\(s\): current/);
  assert.throws(() => defineBackend({ permissions: { canComment: true } }), /permissions\.canComment must be function/);
  assert.throws(() => defineBackend({ store: memoryBackend().store, identity: null, permissions: 'x' }), /permissions must be an object/);

  const firebaseLike = { store: memoryBackend().store, identity: { current: () => null, signIn() {} }, db: {}, admin: {} };
  const b = defineBackend(firebaseLike);
  assert.equal(b.store, firebaseLike.store, 'parts are passed through, not wrapped');
  assert.deepEqual(b.capabilities, { realtime: true, counts: true, identity: true, signIn: true, permissions: false });
  assert.deepEqual(defineBackend({}).capabilities, { realtime: false, counts: false, identity: false, signIn: false, permissions: false });
});

test('checkStore reports a broken store instead of throwing', async () => {
  const { store } = memoryBackend();
  const broken = { ...store, subscribe: undefined, addReply: async () => {} };   // drops replies
  const report = await checkStore(broken);
  assert.equal(report.ok, false);
  assert.deepEqual(report.results.filter(r => !r.ok).map(r => r.name), ['addReply() appends a message']);
});

test('src/comments.css matches the CSS injected by src/comments.js', () => {
  const js = readFileSync(new URL('../src/comments.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/comments.css', import.meta.url), 'utf8');
  assert.equal(css, cssFromSource(js), 'run npm run build:css');
});
