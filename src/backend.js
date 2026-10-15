/*!
 * canvas-comments-kit — the backend contract.
 *
 * The overlay owns the UI; a backend owns the data and who the user is. A backend is
 * a plain object with up to three parts, each duck-typed (no base class, no SDK):
 *
 *   {
 *     store,         // REQUIRED by the overlay (it falls back to localStorage when omitted)
 *     identity,      // optional — signed-in user; omit for a free-text name field
 *     permissions,   // optional — role gating; omit to let anyone comment
 *   }
 *
 * Every store method may be sync or async. The overlay passes the CURRENT context
 * (init's `context`, resolved) as the LAST argument of every store call, so a store can
 * be context-agnostic; a store that binds its own context may ignore it.
 *
 *   store.list(context)                      -> Thread[]
 *   store.addThread(thread, context)         -> Thread | void   (return it to adopt a server id)
 *   store.addReply(threadId, msg, context)   -> Message | void
 *   store.update(threadId, patch, context)   -> void            (e.g. { resolved: true })
 *   store.remove(threadId, context)          -> void
 *   store.subscribe(cb, context)             -> unsubscribe     (optional; realtime, replaces list())
 *   store.countFor(context)                  -> number          (optional; sync unresolved count)
 *   store.countsByContext(prefix, cb)        -> unsubscribe     (optional; cb({ context: [rev|null, …] }))
 *
 *   identity.current()        -> { name, uid?, photo?, email?, anonymous? } | null
 *   identity.signIn()         -> Promise   (optional)
 *   identity.signOut()        -> Promise   (optional)
 *   identity.subscribe(cb)    -> unsubscribe (optional; cb on auth changes)
 *   identity.renderSignIn(el) -> void      (optional; render an inline sign-in button into el)
 *
 *   permissions.canComment()  -> bool     (optional; default true)
 *   permissions.canModerate() -> bool     (optional; default false)
 *   permissions.role()        -> string|null (optional; informational)
 *   permissions.subscribe(cb) -> unsubscribe (optional)
 */

export const CONTRACT = {
  store: { required: ['list', 'addThread', 'addReply', 'update', 'remove'], optional: ['subscribe', 'countFor', 'countsByContext'] },
  identity: { required: ['current'], optional: ['signIn', 'signOut', 'subscribe', 'renderSignIn'] },
  permissions: { required: [], optional: ['canComment', 'canModerate', 'role', 'subscribe'] },
};

function check(part, obj) {
  if (typeof obj !== 'object' && typeof obj !== 'function') {
    throw new TypeError(`canvas-comments-kit: backend.${part} must be an object, got ${obj === null ? 'null' : typeof obj}`);
  }
  const { required, optional } = CONTRACT[part];
  const missing = required.filter(k => typeof obj[k] !== 'function');
  if (missing.length) throw new TypeError(`canvas-comments-kit: backend.${part} is missing method(s): ${missing.join(', ')}`);
  const wrong = optional.filter(k => obj[k] != null && typeof obj[k] !== 'function');
  if (wrong.length) throw new TypeError(`canvas-comments-kit: backend.${part}.${wrong.join(', ')} must be function(s)`);
}

/**
 * Validate a backend and describe what it can do. Only the parts present are checked, so
 * a partial backend (e.g. `{ identity }` for setBackend) is fine. Extra keys — an SDK
 * handle, an admin API — are ignored, so an adapter's whole return value can be passed.
 * Returns `{ store, identity, permissions, capabilities }`; the parts are the originals,
 * not wrappers.
 */
export function defineBackend(backend = {}) {
  if (!backend || typeof backend !== 'object') throw new TypeError('canvas-comments-kit: backend must be an object');
  const { store, identity, permissions } = backend;
  if (store != null) check('store', store);
  if (identity != null) check('identity', identity);
  if (permissions != null) check('permissions', permissions);
  return {
    store: store || undefined,
    identity: identity || undefined,
    permissions: permissions || undefined,
    capabilities: {
      realtime: !!(store && store.subscribe),
      counts: !!(store && store.countsByContext),
      identity: !!identity,
      signIn: !!(identity && identity.signIn),
      permissions: !!permissions,
    },
  };
}

export default defineBackend;
