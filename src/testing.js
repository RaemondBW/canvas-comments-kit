/*!
 * canvas-comments-kit — store contract checker.
 *
 * Run it against your own backend to confirm the overlay will work with it:
 *
 *   import { checkStore } from 'canvas-comments-kit/testing'
 *   const report = await checkStore(myBackend.store, { context: 'contract-test' })
 *   if (!report.ok) console.table(report.results)
 *
 * It WRITES one thread into `context` and removes it again, so point it at a scratch
 * context (or a test database). Framework-agnostic: no test runner required.
 */
import { defineBackend } from './backend.js';

/**
 * @param {object} store
 * @param {object} [opts]
 * @param {string} [opts.context]   scratch context to write into
 * @param {number} [opts.timeout=5000]  ms to wait for realtime updates
 * @returns {Promise<{ ok: boolean, results: { name: string, ok: boolean, error?: string }[] }>}
 */
export async function checkStore(store, { context = 'cck-contract-' + Date.now().toString(36), timeout = 5000 } = {}) {
  const results = [];
  const step = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); return true; }
    catch (e) { results.push({ name, ok: false, error: (e && e.message) || String(e) }); return false; }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const findIn = async id => ((await store.list(context)) || []).find(t => t.id === id);

  if (!await step('implements the store contract', () => defineBackend({ store }))) return { ok: false, results };

  const id = 'cck' + Math.random().toString(36).slice(2, 10);
  const thread = {
    id, resolved: false, ts: Date.now(),
    anchor: { kind: 'point', x: 1, y: 2, label: 'Contract test' },
    messages: [{ id: id + 'm1', author: 'Tester', text: 'first', ts: Date.now() }],
  };
  let tid = id;

  let unsub = null, latest = null, waiters = [];
  if (store.subscribe) {
    await step('subscribe() returns an unsubscribe function', () => {
      unsub = store.subscribe(list => { latest = list; waiters = waiters.filter(w => !w(list)); }, context);
      assert(typeof unsub === 'function', 'subscribe must return a function');
    });
  }
  const until = (pred, what) => new Promise((res, rej) => {
    if (latest && pred(latest)) return res();
    const t = setTimeout(() => rej(new Error('no realtime update: ' + what)), timeout);
    waiters.push(list => { if (pred(list)) { clearTimeout(t); res(); return true; } return false; });
  });

  const added = await step('addThread() then list() returns it', async () => {
    const saved = await store.addThread(thread, context);
    if (saved && saved.id) tid = saved.id;
    const t = await findIn(tid);
    assert(t, 'thread not in list() after addThread()');
    assert(t.anchor && t.anchor.x === 1 && t.anchor.label === 'Contract test', 'anchor not preserved');
    assert(Array.isArray(t.messages) && t.messages.length === 1 && t.messages[0].text === 'first', 'first message not preserved');
  });
  if (added && unsub) await step('subscribe() sees the new thread', () => until(l => l.some(t => t.id === tid), 'added thread'));

  if (added) {
    await step('addReply() appends a message', async () => {
      await store.addReply(tid, { id: id + 'm2', author: 'Tester', text: 'second', ts: Date.now() }, context);
      const t = await findIn(tid);
      assert(t && t.messages.length === 2 && t.messages[1].text === 'second', 'reply not appended in order');
    });
    await step('update() patches fields', async () => {
      await store.update(tid, { resolved: true }, context);
      const t = await findIn(tid);
      assert(t && t.resolved === true, 'resolved flag not updated');
    });
    if (unsub) await step('subscribe() sees updates', () => until(l => l.some(t => t.id === tid && t.resolved), 'resolved thread'));
    await step('remove() deletes the thread', async () => {
      await store.remove(tid, context);
      assert(!(await findIn(tid)), 'thread still listed after remove()');
    });
    if (unsub) await step('subscribe() sees the removal', () => until(l => !l.some(t => t.id === tid), 'removed thread'));
  }
  if (unsub) await step('unsubscribe() runs cleanly', () => { unsub(); });

  return { ok: results.every(r => r.ok), results };
}

export default checkStore;
