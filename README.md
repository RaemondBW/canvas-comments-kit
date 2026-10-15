# canvas-comments-kit

A front-end framework for **threaded comments pinned to a canvas or SVG scene**,
with a backend you define. The kit draws pin markers, a placement ghost and the
thread panel over your scene. You supply two things:

1. **A scene adapter**: a few hooks that map between your world coordinates and the screen.
2. **A backend**: plain objects for storage, and optionally identity and permissions.
   They can wrap anything: localStorage, a REST API, Firebase, Supabase, a WebSocket server.

The kit knows nothing about your scene or your server.

- No dependencies and no build step. It ships as ES modules and injects its own CSS.
- It works over an `<svg>` or a `<canvas>`, because the overlay is positioned DOM.
- The backend contract is duck-typed and validated, with TypeScript types and a
  contract checker you can run against your own backend.

Extracted from [canvas-comments](https://github.com/RaemondBW/canvas-comments),
which uses it with a Firebase backend.

## Quick start

```js
import { createComments, httpBackend } from 'canvas-comments-kit'

const comments = createComments()
comments.init({
  context: 'doc-42',                                   // storage scope: string | () => string
  surface: canvasEl,                                   // element pointer events fire on
  stage:   containerEl,                                // position:relative container to overlay into
  button:  document.getElementById('cmt-btn'),         // optional toolbar toggle
  project:       (x, y) => app.toScreen(x, y),         // world -> { sx, sy } relative to stage
  resolveAnchor: (clientX, clientY) => anchorAt(clientX, clientY),
  onViewChange:  cb => app.onViewportChange(cb),       // call cb on every pan/zoom
  backend: httpBackend({ baseUrl: '/api/comments' }),  // omit → localStorage
  onError: (err, op) => toast(`Couldn't ${op}: ${err.message}`),
})

// in your surface's click / pointerup handler, give comments first refusal:
canvasEl.addEventListener('click', e => {
  if (comments.isPlacing()) { comments.place(e.clientX, e.clientY); return }
  // … your own click handling
})
```

Try [`examples/index.html`](examples/index.html) (serve the repo root, e.g.
`python3 -m http.server`, then open `/examples/`). It switches between the memory,
localStorage and a deliberately flaky backend.

## The scene adapter

| Hook | Signature | Purpose |
|------|-----------|---------|
| `context` | `string \| () => string` | Storage scope (document, sheet, page…). Call `setContext()` after it changes. |
| `surface` | element | Where `pointermove`/`pointerleave` are listened for; gets a `cmt-surface` class. |
| `stage` | element | `position:relative` container the overlay is appended to. |
| `button` | element? | Optional toggle; gets `.on` while placing. |
| `project(x, y)` | `-> { sx, sy }` | World → screen (px, relative to `stage`). |
| `resolveAnchor(clientX, clientY)` | `-> Anchor \| null` | Hit-test at a viewport pixel. |
| `onViewChange(cb)` | | Register `cb` to run on every pan/zoom. |
| `onChange()` | optional | Threads changed (refresh a badge). |
| `onError(err, op)` | optional | A backend call failed (`op`: `list`, `subscribe`, `addThread`, `addReply`, `update`, `remove`). Defaults to `console.warn`. A failed send keeps the typed text. |
| `backend` | optional | `{ store, identity?, permissions? }`. See below. |
| `rev()`, `latestRev()`, `diffRev()` | optional | Revision-aware hosts: lock threads to the revision they were written on and tag them `new`/`gone` in a diff. |

### Anchor

```js
{ kind, x, y, ref?, label?, tx?, ty?, off? }
```

- `kind` is your category string (`'part'`, `'shape'`, `'point'`…). It is informational only.
- `x, y` are the world coords of the marker, usually the cursor position.
- `ref` is the stable id of the object being commented on. `label` is the thread title.
- `tx, ty` give a world point for the pin to **aim at**. With them the marker is a
  teardrop pointing at that point; without them it is a plain circle.
- `off` is a `{ dx, dy }` screen-pixel offset from the projected `(tx, ty)`. The pin then
  hangs a fixed pixel gap off the object at any zoom. Compute it with `screenOffset`:

  ```js
  import { screenOffset } from 'canvas-comments-kit'
  const off = screenOffset(project, cursorSx, cursorSy, tx, ty /*, gapPx = 24 */)
  ```

## Backends

A backend is `{ store, identity?, permissions? }`. Extra keys (an SDK handle, an admin
API) are ignored, so you can pass an adapter's whole return value.

### Store (required; defaults to localStorage)

Every method may be sync or async. **The current context is passed as the last
argument**, so one store can serve every document. A store that binds its own
context can ignore it.

```js
{
  list(context)                     // -> Thread[]
  addThread(thread, context)        // -> Thread | void  (return it to adopt a server-assigned id)
  addReply(threadId, msg, context)  // -> Message | void
  update(threadId, patch, context)  // -> void           ({ resolved }, or { messages })
  remove(threadId, context)         // -> void
  subscribe(cb, context)            // optional: realtime. cb(Thread[]) now + on every change; -> unsubscribe
  countFor(context)                 // optional: sync unresolved count, for badges
  countsByContext(prefix, cb)       // optional: live { context: [rev|null, …] } for every context with prefix; -> unsubscribe
}
```

`Thread` is `{ id, anchor, resolved, ts, messages: Message[], rev? }`.
`Message` is `{ id, author, text, ts, authorUid?, photo? }`.

When `subscribe` exists the kit uses it instead of `list()` polling, and re-subscribes
on `setContext()` and `setStore()`.

### Identity (optional)

```js
{
  current()          // -> { name, uid?, photo?, email?, anonymous? } | null
  signIn()           // optional -> Promise
  signOut()          // optional
  subscribe(cb)      // optional -> unsubscribe; cb on auth changes
  renderSignIn(el)   // optional: render an inline sign-in button (e.g. Google Identity Services)
}
```

Without an identity the composer has a free-text name field. With one, signed-in users
post as themselves (`author`, `authorUid`, `photo`) and signed-out users see **Sign in to
comment**. A user with `anonymous: true` comments under a typed name but keeps their uid.
When that same uid later becomes a real account, the kit re-attributes their past
messages.

### Permissions (optional)

```js
{
  canComment()   // -> bool   (default true)
  canModerate()  // -> bool   (default false; may delete others' threads)
  role()         // -> string | null  (shown on the read-only panel)
  subscribe(cb)  // optional -> unsubscribe
}
```

When `canComment()` is false the button is hidden and the panel is read-only. The
author of a thread's first message, or a moderator, gets a delete button.

### Built-in backends

| Import | What it is |
|--------|------------|
| `localStorageBackend({ context?, prefix? })` | The default. Keys are `xcomments:<context>`. Includes `countFor` and `countsByContext`. `makeLocalStore(context)` returns the bare store. |
| `memoryBackend({ context?, threads?, latency? })` | In-memory and realtime. Useful for demos, tests and fixtures. `dump()` returns the data. |
| `httpBackend({ baseUrl, headers?, fetch?, poll?, counts?, routes? })` | Generic REST. Polling `subscribe` when `poll` is set. Routes are listed below and can be renamed with `routes`. |

`httpBackend` expects these routes (JSON in and out):

```
GET    /threads?context=<ctx>        -> Thread[]
POST   /threads                      body: Thread & { context }   -> Thread (may assign id)
POST   /threads/:id/messages         body: Message & { context }  -> Message
PATCH  /threads/:id                  body: patch & { context }
DELETE /threads/:id?context=<ctx>
GET    /counts?prefix=<p>            -> { [context]: (rev|null)[] }   (with counts: true)
```

Auth belongs to you. Pass `headers: async () => ({ Authorization: 'Bearer ' + await getToken() })`.

### Writing your own

Return plain objects. Here is a sketch over a realtime SDK:

```js
export function myBackend(sdk) {
  return {
    store: {
      list: ctx => sdk.query('threads', { context: ctx }),
      addThread: (t, ctx) => sdk.insert('threads', { ...t, context: ctx }),
      addReply: (id, m) => sdk.push(`threads/${id}/messages`, m),
      update: (id, patch) => sdk.patch(`threads/${id}`, patch),
      remove: id => sdk.delete(`threads/${id}`),
      subscribe: (cb, ctx) => sdk.watch('threads', { context: ctx }, cb),
    },
    identity: {
      current: () => sdk.user && { name: sdk.user.name, uid: sdk.user.id },
      signIn: () => sdk.signIn(),
      subscribe: cb => sdk.onAuth(cb),
    },
  }
}
```

`init` validates the backend with `defineBackend()`. A missing method throws a
descriptive `TypeError` when the overlay mounts, instead of failing on first use. Call
`defineBackend(b).capabilities` yourself to see what the kit will use:
`{ realtime, counts, identity, signIn, permissions }`.

Then check it against the contract (this writes and removes one thread, so point it
at a scratch context):

```js
import { checkStore } from 'canvas-comments-kit/testing'
const { ok, results } = await checkStore(myBackend(sdk).store, { context: 'contract-test' })
```

## Controller API

| Method | |
|--------|--|
| `init(config)` | Mount the overlay. Call once. |
| `isPlacing()` / `place(clientX, clientY)` / `toggle()` | Placement mode. |
| `reproject()` | Re-lay markers (also wired via `onViewChange`). |
| `setContext()` | Reload/resubscribe after `context` changed. |
| `setStore(store)` | Swap just the store. |
| `setBackend(backend)` | Attach or swap any of `{ store, identity, permissions }` after init. Use it for backends that load asynchronously: start on the default store, then upgrade. |
| `capabilities()` | What the attached backend supports. |
| `countFor(context)` | Unresolved count for any context (needs `store.countFor`). |
| `watchCounts(prefix, cb)` | Live per-context counts for badges. Uses `store.countsByContext`, or the loaded threads when the store has none. |
| `screenOffset(...)` | See *Anchor*. |

Importing the module also sets `window.Comments` (a shared instance) and
`window.createComments`, for pages that use a bare `<script type="module">`.

## Theming

```css
:root {
  --cmt-accent: #F5A623;  --cmt-accent-border: #D98E12;  --cmt-send: #2563a8;
  --cmt-font: 'Inter', system-ui, sans-serif;  --cmt-mono: ui-monospace, monospace;
  --cmt-add: #1A7F37;  --cmt-del: #CF222E;   /* diff tags */
}
```

`src/comments.css` contains the same rules as a stylesheet, for bundlers that want to
own the CSS. It is generated, so run `npm run build:css` after editing the CSS in
`src/comments.js`.

## Limits

- **One overlay per page.** The overlay DOM uses fixed ids (`#cmt-layer`, `#cmt-panel`, `#cmt-ghost`).
- `stage` must be positioned. Give it `overflow:hidden` to clip markers to the viewport.

## Development

```sh
npm test            # node --test: backend contracts, validation, CSS sync
npm run build:css   # regenerate src/comments.css
```
