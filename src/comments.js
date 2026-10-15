/*!
 * canvas-comments-kit — a drop-in threaded-comment overlay for canvas / SVG apps.
 *
 * A comment thread (an initial message + replies) is anchored to a point in your
 * scene — optionally to a specific object (a part, a shape, a net, a pin…). The
 * library renders draggable-free pin markers over your canvas, a placement ghost,
 * and a message panel. It knows nothing about your scene: you hand it a few hooks
 * and it calls them.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   import { createComments } from 'canvas-comments-kit'
 *
 *   const comments = createComments()
 *   comments.init({
 *     context:      'my-doc',               // storage scope (string | () => string)
 *     surface:      canvasEl,               // the element pointer events fire on (SVG or <canvas>)
 *     stage:        canvasContainerEl,      // a position:relative container the overlay is added to
 *     button:       document.getElementById('cmt-btn'),   // optional toolbar toggle
 *     project:      (x, y) => ({ sx, sy }), // world coords -> screen coords relative to `stage`
 *     resolveAnchor:(clientX, clientY) => ({ kind, x, y, ref?, label?, tx?, ty?, off? }),
 *     onViewChange: cb => { ... },          // call cb whenever the view pans/zooms
 *     onChange:     () => { ... },          // optional: threads changed (e.g. refresh a badge)
 *     onError:      (err, op) => { ... },   // optional: a backend call failed
 *     backend:      { store, identity, permissions },   // optional; defaults to localStorage
 *   })
 *
 * In your surface's click / pointerup handler, give comments first refusal:
 *   if (comments.isPlacing()) { comments.place(e.clientX, e.clientY); return }
 *
 * The backend contract (store / identity / permissions) is documented in backend.js;
 * the anchor object and the full adapter in the README.
 */

import { defineBackend } from './backend.js';
import { localStorageBackend } from './backends/local.js';

const CSS = `
:root{
  --cmt-accent:#F5A623; --cmt-accent-border:#D98E12; --cmt-send:#2563a8;
  --cmt-font:'IBM Plex Sans',system-ui,-apple-system,sans-serif;
  --cmt-mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,monospace;
}
#cmt-layer{position:absolute;inset:0;pointer-events:none;z-index:16;overflow:hidden}
.cmt-marker{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer}
.cmt-marker .pin{width:22px;height:22px;border-radius:50% 50% 50% 3px;background:var(--cmt-accent);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center}
.cmt-marker.circle .pin{border-radius:50%!important;transform:none!important}
.cmt-marker .pin b{color:#fff;font:700 11px var(--cmt-mono)}
.cmt-marker.resolved .pin{background:#9AA0A8}
.cmt-marker.new .pin{background:var(--cmt-add,#1A7F37)}
.cmt-marker.gone .pin{background:var(--cmt-del,#CF222E)}
.cmt-marker.gone{opacity:.82}
.cmt-marker.active .pin{outline:2px solid var(--cmt-send);outline-offset:2px}
body.cmt-placing .cmt-surface,body.cmt-placing .cmt-surface *{cursor:default!important}
#cmt-ghost{position:absolute;transform:translate(-50%,-50%);pointer-events:none;z-index:17}
#cmt-ghost .pin{width:22px;height:22px;border-radius:50% 50% 50% 3px;background:var(--cmt-accent);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.32)}
#cmt-ghost.circle .pin{border-radius:50%!important;transform:none!important}
.tbtn.on,#cmt-btn.on,.cmt-toggle.on{background:var(--cmt-accent);border-color:var(--cmt-accent-border);color:#fff}
#cmt-panel{position:absolute;width:306px;max-height:78%;display:none;flex-direction:column;background:#fff;border:1px solid #E0DCD1;border-radius:12px;box-shadow:0 16px 40px rgba(20,16,8,.24);z-index:41;overflow:hidden;font-family:var(--cmt-font)}
#cmt-panel .cmt-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px 9px 13px;border-bottom:1px solid #EEE9DE;font-size:12px}
#cmt-panel .cmt-anchor{font-weight:700;color:#3A362D;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cmt-panel .cmt-head span{display:flex;align-items:center;gap:6px;flex-shrink:0}
#cmt-panel .cmt-head button{cursor:pointer;border:1px solid #D9D4C6;background:#fff;border-radius:6px;font-size:11px;padding:2px 8px;color:#6E6A60}
#cmt-panel .cmt-msgs{overflow-y:auto;padding:2px 13px}
#cmt-panel .cmt-msg{padding:8px 0;border-bottom:1px solid #F2EEE3}
#cmt-panel .cmt-msg:last-child{border-bottom:none}
#cmt-panel .cmt-meta{font-size:10.5px;color:#A19B8E;margin-bottom:2px}
#cmt-panel .cmt-meta b{color:#5A5648;font-weight:600}
#cmt-panel .cmt-text{font-size:12.5px;color:#221F1A;white-space:pre-wrap;word-break:break-word;line-height:1.4}
#cmt-panel .cmt-empty{font-size:11px;color:#A19B8E;padding:8px 0}
#cmt-panel .cmt-reply{display:flex;flex-direction:column;gap:6px;padding:8px 12px;border-top:1px solid #EEE9DE;background:#FBFAF7}
#cmt-panel .cmt-row{display:flex;gap:6px;align-items:center}
#cmt-panel .cmt-input{resize:none;border:1px solid #D9D4C6;border-radius:6px;padding:6px 8px;font:12px var(--cmt-font);outline:none}
#cmt-panel .cmt-input:focus,#cmt-panel .cmt-author:focus{border-color:var(--cmt-accent)}
#cmt-panel .cmt-author{flex:1;min-width:0;border:1px solid #D9D4C6;border-radius:6px;padding:4px 7px;font:11px var(--cmt-font);outline:none;color:#5A5648}
#cmt-panel .cmt-send{cursor:pointer;border:none;background:var(--cmt-send);color:#fff;border-radius:6px;font-size:12px;padding:0 14px;height:26px}
#cmt-panel .cmt-send:disabled{background:#B9BEC6;cursor:default}
#cmt-panel .cmt-avatar{width:16px;height:16px;border-radius:50%;object-fit:cover;margin-right:5px;flex:0 0 auto}
#cmt-panel .cmt-meta{display:flex;align-items:center}
#cmt-panel .cmt-user{display:flex;align-items:center;gap:6px;min-width:0;color:#5A5648;font-size:11px}
#cmt-panel .cmt-user img{width:20px;height:20px;border-radius:50%;flex:0 0 auto}
#cmt-panel .cmt-user b{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cmt-panel .cmt-signin{cursor:pointer;border:none;background:var(--cmt-send);color:#fff;border-radius:6px;font:600 12px var(--cmt-font);padding:8px 12px;width:100%;display:flex;align-items:center;justify-content:center;gap:7px}
#cmt-panel .cmt-readonly{padding:9px 13px;font-size:11px;color:#A19B8E;font-style:italic}
#cmt-panel .cmt-del{cursor:pointer;border:1px solid #E6C9C4;background:#fff;border-radius:6px;padding:2px 6px;color:#B4453A;display:inline-flex;align-items:center}
#cmt-panel .cmt-del:hover{background:#FBEEEC}
#cmt-signin-pop{position:fixed;z-index:80;background:#fff;border:1px solid #E0DCD1;border-radius:12px;box-shadow:0 16px 40px rgba(20,16,8,.24);padding:16px;display:none;font-family:var(--cmt-font)}
#cmt-signin-pop .cmt-signin-head{font:600 12px var(--cmt-font);color:#3A362D;margin-bottom:11px}
`;

function injectCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('cmt-style')) return;
  const s = document.createElement('style');
  s.id = 'cmt-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/**
 * Compute an anchor's `off` (screen-pixel offset) so an object-attached pin hangs a fixed
 * `gap` px from its target in the direction the user placed it — and keeps that gap at any
 * zoom. Pass the same `project(x,y)->{sx,sy}` you give init(), the cursor position in that
 * same screen space (`cursorSx,cursorSy`), and the world target (`tx,ty`). Returns
 * `{ dx, dy }` to put on the anchor as `off`, or null when there's no target. Framework-
 * agnostic: it only uses `project`, so it works over SVG or canvas.
 */
export function screenOffset(project, cursorSx, cursorSy, tx, ty, gap = 24) {
  if (tx == null) return null;
  const t = project(tx, ty); if (!t) return null;
  let dx = cursorSx - t.sx, dy = cursorSy - t.sy, m = Math.hypot(dx, dy);
  if (m < 1) { dx = 0.7; dy = -0.7; m = 1; }   // cursor right on the target → default up-right
  return { dx: dx / m * gap, dy: dy / m * gap };
}

/**
 * Create an independent comment-overlay controller. Call `.init(adapter)` once
 * your scene is mounted. Multiple instances can coexist only if they target
 * different `stage` elements is NOT yet supported — the overlay DOM uses fixed
 * ids, so use one instance per page.
 */
export function createComments() {
  const $ = id => document.getElementById(id);
  const esc = s => (s == null ? '' : s + '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => Date.now();
  const fmt = ts => { try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

  let cfg, store, threads = [], placing = false, openId = null, draft = null, author = '';
  let unsub = null;   // active realtime subscription teardown (when store.subscribe exists)
  let countWatch = null, countUnsub = null;   // doc-wide per-context counts (page badges)

  // The current storage context, passed as the last argument of every store call so a
  // backend can be context-agnostic (stores that bind their own context ignore it).
  const ctx = () => (cfg && typeof cfg.context === 'function' ? cfg.context() : cfg && cfg.context);

  // A backend call failed: hand it to the host, or log it. The overlay keeps its state
  // (a failed send leaves the typed text in the composer).
  function fail(op, e) {
    if (cfg && cfg.onError) { try { cfg.onError(e, op); } catch (x) { } }
    else console.warn('[canvas-comments-kit] ' + op + ' failed:', e);
  }

  // Per-context unresolved counts for every thread whose context starts with
  // `prefix` — powers per-sheet badges even under a realtime backend that only
  // streams the CURRENT context. Reports { context: [rev, …] } so the host can
  // count by the revision it is showing. Uses the backend's countsByContext when
  // present; otherwise counts the threads already loaded for the current context.
  function loadedCounts(prefix) {
    const c = ctx(), m = {};
    if (c == null || String(c).indexOf(prefix) !== 0) return m;
    const revs = threads.filter(t => !t.resolved).map(t => (t.rev == null ? null : t.rev));
    if (revs.length) m[c] = revs;
    return m;
  }
  function startCountWatch() {
    if (countUnsub) { try { countUnsub(); } catch (e) { } countUnsub = null; }
    if (!countWatch) return;
    if (store && store.countsByContext) countUnsub = store.countsByContext(countWatch.prefix, countWatch.cb);
    else countWatch.cb(loadedCounts(countWatch.prefix));
  }

  // Push a fresh thread list into the UI. Both the pull path (reload) and the
  // realtime path (store.subscribe) funnel through here.
  function applyThreads(list) {
    threads = list || [];
    renderMarkers();
    if (openId) { const t = threads.find(x => x.id === openId); if (t) openThread(openId); else closePanel(); }
    if (countWatch && !(store && store.countsByContext)) countWatch.cb(loadedCounts(countWatch.prefix));
    if (cfg && cfg.onChange) cfg.onChange();
  }
  async function reload() {
    let list;
    try { list = await store.list(ctx()); } catch (e) { fail('list', e); return; }
    applyThreads(list);
  }

  // Track the current context's threads. If the store offers realtime updates
  // (store.subscribe(cb) -> unsubscribe) use them; otherwise fall back to a
  // one-shot pull. Called on init, on context switch, and on setStore.
  function resubscribe() {
    if (unsub) { try { unsub(); } catch (e) { } unsub = null; }
    // Clear the previous context's markers immediately. A realtime store repopulates
    // asynchronously (a network round-trip), so without this the old sheet's markers
    // linger until the new subscription's first snapshot arrives.
    if (store && store.subscribe) {
      applyThreads([]);
      try { unsub = store.subscribe(applyThreads, ctx()); } catch (e) { fail('subscribe', e); }
    }
    else reload();
  }

  // The signed-in user (name/photo/uid) when an identity provider is wired, else null.
  const idUser = () => (cfg && cfg.identity && cfg.identity.current) ? cfg.identity.current() : null;
  const hasIdentity = () => !!(cfg && cfg.identity);

  // Role/permission gating. With no `permissions` provider anyone may comment
  // (the default, non-platform behavior); with one, the host answers per action.
  const perms = () => (cfg && cfg.permissions) || null;
  const canComment = () => { const p = perms(); return (p && p.canComment) ? !!p.canComment() : true; };
  const canModerate = () => { const p = perms(); return (p && p.canModerate) ? !!p.canModerate() : false; };
  // A thread is deletable by a moderator, or by the author of its first message —
  // but only while that author can still comment (a demoted viewer is read-only).
  // Only offered in platform mode (a permissions provider present).
  function canDeleteThread(t) {
    if (!perms()) return false;
    const u = idUser(), owner = t.messages && t.messages[0] && t.messages[0].authorUid;
    return canModerate() || (canComment() && !!(u && owner && u.uid === owner));
  }
  // Reflect the current role in the chrome. Keep the placement button for anyone
  // who can comment OR who is simply logged out (so they can click it to sign in);
  // hide it only for signed-in users who can't comment (viewers / non-members).
  const canSignIn = () => hasIdentity() && !idUser() && !!cfg.identity.signIn;
  function applyPerms() {
    if (cfg && cfg.button) cfg.button.style.display = (canComment() || canSignIn()) ? '' : 'none';
    if (!canComment() && placing) setPlacing(false);
  }

  // An anchor attached to an object (has tx/ty + a screen-space offset) hangs a fixed
  // pixel distance off the object point, so it tracks the object at any zoom rather than
  // sitting at a fixed world point that drifts away as you zoom in. Everything else (a
  // free "open space" comment) stays pinned to its world coords.
  const markerPos = a => {
    if (a.tx != null && a.off) { const t = cfg.project(a.tx, a.ty); return t ? { sx: t.sx + a.off.dx, sy: t.sy + a.off.dy } : null; }
    return cfg.project(a.x, a.y);
  };

  function markerRot(anchor, p) {   // rotation (deg) so the pin points at anchor.tx/ty, or null
    if (anchor.tx == null) return null;
    const tp = cfg.project(anchor.tx, anchor.ty);
    return Math.atan2(tp.sy - p.sy, tp.sx - p.sx) * 180 / Math.PI - 135;
  }
  function markerHtml(cls, p, rot, inner, id, title) {
    const pt = rot != null ? ` style="transform:rotate(${rot}deg)"` : '';
    const bt = rot != null ? ` style="transform:rotate(${-rot}deg)"` : '';   // keep the number upright
    return `<div class="cmt-marker${rot == null ? ' circle' : ''}${cls}"${id ? ` data-id="${esc(id)}"` : ''} style="left:${p.sx}px;top:${p.sy}px"${title ? ` title="${title}"` : ''}><div class="pin"${pt}><b${bt}>${inner}</b></div></div>`;
  }
  // Version scoping. A thread carries the revision it was authored on (t.rev).
  // With a rev-aware host (cfg.rev present) a comment is LOCKED to its version:
  //   - normal view  → show only threads whose rev is the one being viewed
  //   - diff view    → show both revisions' threads, tagged 'new' (only in the
  //                    newer rev) or 'gone' (only in the older rev)
  // A thread with no rev (made before versioning) is treated as belonging to the
  // LATEST rev — so it shows on the current design, not duplicated onto every rev.
  // With no rev-aware host at all (Vector Designer), everything shows untagged.
  // Returns '' (show, untagged), 'new', 'gone', or 'hide' (don't render).
  function threadTag(t) {
    if (!cfg || !cfg.rev) return '';
    const cur = cfg.rev(); if (cur == null) return '';
    const latest = cfg.latestRev ? cfg.latestRev() : cur;
    const r = (t.rev == null) ? latest : t.rev;
    const dv = cfg.diffRev ? cfg.diffRev() : null;
    if (dv == null || dv === cur) return r === cur ? '' : 'hide';
    if (r === cur) return 'new';
    if (r === dv) return 'gone';
    return 'hide';
  }

  function renderMarkers() {
    const layer = $('cmt-layer'); if (!layer) return;
    let h = '';
    for (const t of threads) {
      const tag = threadTag(t); if (tag === 'hide') continue;
      const p = markerPos(t.anchor); if (!p) continue;
      h += markerHtml((t.resolved ? ' resolved' : '') + (t.id === openId ? ' active' : '') + (tag ? ' ' + tag : ''), p, markerRot(t.anchor, p),
        t.messages.length || 1, t.id, esc((tag === 'new' ? '● new · ' : tag === 'gone' ? '● was rev ' + t.rev + ' · ' : '') + (t.anchor.label || 'Comment') + ' · ' + ((t.messages[0] || {}).text || '')));
    }
    if (draft) { const p = markerPos(draft.anchor); if (p) h += markerHtml(' active', p, markerRot(draft.anchor, p), '+', '', ''); }
    layer.innerHTML = h;
    [...layer.querySelectorAll('.cmt-marker[data-id]')].forEach(el => el.onclick = ev => { ev.stopPropagation(); openThread(el.dataset.id); });
  }

  function positionPanel(a) {   // keep the panel off the marker AND the item it points at
    const panel = $('cmt-panel'), st = cfg.stage, p = markerPos(a); if (!p) return;
    const w = panel.offsetWidth || 306, h = Math.min(panel.offsetHeight || 260, st.clientHeight - 20), pad = 10, clear = 28;
    let tx = p.sx, ty = p.sy;
    if (a.tx != null) { const tp = cfg.project(a.tx, a.ty); tx = tp.sx; ty = tp.sy; }
    const dx = p.sx - tx, dy = p.sy - ty;   // direction away from the target
    const fitsR = p.sx + clear + w <= st.clientWidth - pad, fitsL = p.sx - clear - w >= pad;
    const fitsB = p.sy + clear + h <= st.clientHeight - pad, fitsA = p.sy - clear - h >= pad;
    let left, top;
    if (Math.abs(dx) >= Math.abs(dy)) {     // target mostly to a side → panel on the opposite side
      left = dx >= 0 ? (fitsR ? p.sx + clear : p.sx - clear - w) : (fitsL ? p.sx - clear - w : p.sx + clear);
      top = p.sy - h / 2;
    } else {                                 // target mostly above/below → panel opposite vertically
      top = dy >= 0 ? (fitsB ? p.sy + clear : p.sy - clear - h) : (fitsA ? p.sy - clear - h : p.sy + clear);
      left = p.sx - w / 2;
    }
    panel.style.left = Math.max(pad, Math.min(left, st.clientWidth - w - pad)) + 'px';
    panel.style.top = Math.max(pad, Math.min(top, st.clientHeight - h - pad)) + 'px';
  }

  // Composer footer. Three shapes: free-text name (no identity provider), a
  // signed-in user row (identity + logged in), or a sign-in prompt (identity,
  // logged out) that replaces the input entirely.
  function replyBlock(isDraft) {
    const label = isDraft ? 'Comment' : 'Reply';
    if (!canComment()) {   // viewer / non-member: read-only, no composer
      const r = perms() && perms().role && perms().role();
      return `<div class="cmt-reply cmt-readonly">${r ? esc(r[0].toUpperCase() + r.slice(1)) + ' · read-only' : 'Read-only access'}</div>`;
    }
    if (hasIdentity()) {
      const u = idUser();
      if (!u) return `<div class="cmt-reply"><button class="cmt-signin">${signinIcon()}Sign in to comment</button></div>`;
      // Anonymous-first: a guest can comment right away with just a display name — their
      // messages still carry their (anonymous) uid, so creating an account later keeps
      // the authorship (the account upgrade preserves the uid).
      if (u.anonymous) {
        return `<div class="cmt-reply"><textarea class="cmt-input" rows="2" placeholder="${isDraft ? 'Write a comment…' : 'Reply…'}"></textarea>` +
          `<div class="cmt-row"><input class="cmt-author" placeholder="Your name" value="${esc(author)}"/><button class="cmt-send">${label}</button></div></div>`;
      }
      const who = `<div class="cmt-user">${u.photo ? `<img src="${esc(u.photo)}" alt=""/>` : ''}<b>${esc(u.name || 'You')}</b></div>`;
      return `<div class="cmt-reply"><textarea class="cmt-input" rows="2" placeholder="${isDraft ? 'Write a comment…' : 'Reply…'}"></textarea>` +
        `<div class="cmt-row">${who}<button class="cmt-send">${label}</button></div></div>`;
    }
    return `<div class="cmt-reply"><textarea class="cmt-input" rows="2" placeholder="${isDraft ? 'Write a comment…' : 'Reply…'}"></textarea>` +
      `<div class="cmt-row"><input class="cmt-author" placeholder="Your name" value="${esc(author)}"/><button class="cmt-send">${label}</button></div></div>`;
  }
  function signinIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.4 0-8 2.7-8 6v2h16v-2c0-3.3-3.6-6-8-6z"/></svg>';
  }
  function trashIcon() {
    return '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>';
  }
  function msgHtml(m) {
    return `<div class="cmt-msg"><div class="cmt-meta">${m.photo ? `<img class="cmt-avatar" src="${esc(m.photo)}" alt=""/>` : ''}<b>${esc(m.author)}</b> · ${esc(fmt(m.ts))}</div><div class="cmt-text">${esc(m.text)}</div></div>`;
  }
  function panelHtml(t, isDraft) {
    return `<div class="cmt-head"><span class="cmt-anchor">${esc(t.anchor.label || 'Comment')}</span><span>` +
      (!isDraft && canDeleteThread(t) ? `<button class="cmt-del" title="Delete thread">${trashIcon()}</button>` : '') +
      (isDraft || !canComment() ? '' : `<button class="cmt-resolve">${t.resolved ? 'Reopen' : 'Resolve'}</button>`) +
      `<button class="cmt-close" title="Close">&times;</button></span></div>` +
      `<div class="cmt-msgs">` + (t.messages.length ? t.messages.map(msgHtml).join('')
        : (isDraft ? '<div class="cmt-empty">New comment thread</div>' : '')) + `</div>` +
      replyBlock(isDraft);
  }

  function openThread(id) {
    draft = null; const t = threads.find(x => x.id === id); if (!t) { closePanel(); return; }
    openId = id; const panel = $('cmt-panel'); panel.style.display = 'flex'; panel.innerHTML = panelHtml(t, false);
    positionPanel(t.anchor); wire(t, false); renderMarkers(); const inp = panel.querySelector('.cmt-input'); if (inp) inp.focus();
  }
  function openDraft(anchor) {
    openId = null; draft = { anchor, messages: [] }; const panel = $('cmt-panel');
    panel.style.display = 'flex'; panel.innerHTML = panelHtml(draft, true);
    positionPanel(anchor); wire(draft, true); renderMarkers(); const inp = panel.querySelector('.cmt-input'); if (inp) inp.focus();
  }
  // Re-render whatever panel is open (used when auth state flips the composer
  // between the sign-in prompt and the real input).
  function refreshPanel() { if (openId) openThread(openId); else if (draft) openDraft(draft.anchor); }
  function closePanel() { openId = null; draft = null; const panel = $('cmt-panel'); if (panel) panel.style.display = 'none'; renderMarkers(); }
  function hideGhost() { const g = $('cmt-ghost'); if (g) g.style.display = 'none'; }

  function wire(t, isDraft) {
    const panel = $('cmt-panel');
    panel.querySelector('.cmt-close').onclick = closePanel;
    const rb = panel.querySelector('.cmt-resolve'); if (rb) rb.onclick = async () => { try { await store.update(t.id, { resolved: !t.resolved }, ctx()); } catch (e) { fail('update', e); return; } await reload(); };
    const del = panel.querySelector('.cmt-del'); if (del) del.onclick = async () => { closePanel(); try { await store.remove(t.id, ctx()); } catch (e) { fail('remove', e); } await reload(); };
    // Logged-out identity: only a sign-in button is shown. Kick off sign-in; the
    // identity subscription re-renders the panel into the real composer.
    const sb = panel.querySelector('.cmt-signin');
    if (sb) { sb.onclick = () => { if (cfg.identity && cfg.identity.signIn) cfg.identity.signIn(); }; return; }
    const send = async () => {
      const ta = panel.querySelector('.cmt-input'); if (!ta) return;
      const txt = (ta.value || '').trim(); if (!txt) return;
      const msg = { id: uid(), text: txt, ts: now() };
      if (hasIdentity()) {
        const u = idUser(); if (!u) { if (cfg.identity.signIn) cfg.identity.signIn(); return; }
        if (u.anonymous) {
          // Guest: typed display name + the anonymous uid (so authorship survives the
          // eventual account upgrade, which keeps this uid).
          const na = panel.querySelector('.cmt-author');
          author = (na && na.value || '').trim() || 'Anonymous'; try { localStorage.setItem('xcomment-author', author); } catch (e) { }
          msg.author = author;
        } else {
          msg.author = u.name || 'User';
          if (u.photo) msg.photo = u.photo;
        }
        if (u.uid) msg.authorUid = u.uid;
      } else {
        const na = panel.querySelector('.cmt-author');
        author = (na.value || '').trim() || 'Anonymous'; try { localStorage.setItem('xcomment-author', author); } catch (e) { }
        msg.author = author;
      }
      // Keep the draft (and the typed text) until the backend accepts the write, and block
      // double-sends while it is in flight.
      const btn = panel.querySelector('.cmt-send'); btn.disabled = true;
      if (isDraft) {
        const nt = { id: uid(), anchor: t.anchor, resolved: false, ts: now(), messages: [msg] };
        if (cfg.rev) { const r = cfg.rev(); if (r != null) nt.rev = r; }
        let saved;
        try { saved = await store.addThread(nt, ctx()); } catch (e) { btn.disabled = false; fail('addThread', e); return; }
        draft = null; await reload(); openThread((saved && saved.id) || nt.id);   // a backend may assign its own id
      } else {
        try { await store.addReply(t.id, msg, ctx()); } catch (e) { btn.disabled = false; fail('addReply', e); return; }
        await reload();
      }
    };
    panel.querySelector('.cmt-send').onclick = send;
    panel.querySelector('.cmt-input').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); } });
  }

  function setPlacing(on) { if (on && !canComment()) return; placing = !!on; document.body.classList.toggle('cmt-placing', placing); if (cfg && cfg.button) cfg.button.classList.toggle('on', placing); if (!placing) hideGhost(); }

  // Inline "Sign in with Google" popover for logged-out users (no popup window).
  // The identity provider renders its own button (e.g. Google Identity Services)
  // into the slot; falls back to identity.signIn() when it can't.
  function openSignin() {
    const id = cfg.identity;
    if (!id || !id.renderSignIn) { if (id && id.signIn) id.signIn(); return; }
    let pop = $('cmt-signin-pop');
    if (!pop) {
      pop = document.createElement('div'); pop.id = 'cmt-signin-pop'; document.body.appendChild(pop);
      pop.addEventListener('pointerdown', e => e.stopPropagation());
    }
    pop.innerHTML = '<div class="cmt-signin-head">Sign in to comment</div><div class="cmt-signin-slot"></div>';
    pop.style.display = 'block';
    const b = cfg.button ? cfg.button.getBoundingClientRect() : { bottom: 44, right: 60 };
    pop.style.top = (b.bottom + 8) + 'px';
    pop.style.left = '8px';   // provisional; right-aligned to the button once measured
    id.renderSignIn(pop.querySelector('.cmt-signin-slot'));
    requestAnimationFrame(() => { pop.style.left = Math.max(8, Math.min(b.right - pop.offsetWidth, (window.innerWidth || 800) - pop.offsetWidth - 8)) + 'px'; });
  }
  function closeSignin() { const p = $('cmt-signin-pop'); if (p) p.style.display = 'none'; }

  return {
    init(config) {
      injectCss();
      cfg = config;
      const surface = config.surface || config.svg;   // `svg` accepted as a legacy alias
      cfg.surface = surface;
      if (surface) surface.classList.add('cmt-surface');
      author = (() => { try { return localStorage.getItem('xcomment-author') || ''; } catch (e) { return ''; } })();
      // The backend: `backend: { store, identity, permissions }`, or the same parts as
      // top-level keys (the pre-kit shape; they win over `backend`). Validated up front so a
      // malformed backend fails here, not on the first click. No store → localStorage.
      const b = defineBackend({
        ...config.backend,
        ...(config.store ? { store: config.store } : null),
        ...(config.identity ? { identity: config.identity } : null),
        ...(config.permissions ? { permissions: config.permissions } : null),
      });
      store = b.store || localStorageBackend({ context: config.context }).store;
      cfg.identity = b.identity; cfg.permissions = b.permissions;
      const st = config.stage;
      if (!$('cmt-layer')) { const l = document.createElement('div'); l.id = 'cmt-layer'; st.appendChild(l); }
      if (!$('cmt-panel')) {
        const p = document.createElement('div'); p.id = 'cmt-panel'; st.appendChild(p);
        p.addEventListener('pointerdown', e => e.stopPropagation());
        p.addEventListener('click', e => e.stopPropagation());
        // Keep the host app's global keyboard shortcuts (space-to-pan, single-key tool
        // switches, etc.) from firing while the user types in a comment. Let only Escape
        // through, so the overlay's own Escape-to-close still works.
        ['keydown', 'keyup', 'keypress'].forEach(t => p.addEventListener(t, e => { if (e.key !== 'Escape') e.stopPropagation(); }));
      }
      if (!$('cmt-ghost')) {   // a ring at the cursor; a pointer rotates toward the nearest item
        // (append to the stage, not #cmt-layer, since renderMarkers() rewrites that layer)
        const g = document.createElement('div'); g.id = 'cmt-ghost'; g.style.display = 'none';
        g.innerHTML = '<div class="pin"></div>';   // the marker pin, minus the number
        st.appendChild(g);
      }
      surface.addEventListener('pointermove', e => {
        if (!placing) return;
        const a = cfg.resolveAnchor(e.clientX, e.clientY); if (!a) { hideGhost(); return; }
        const c = markerPos(a), g = $('cmt-ghost'); if (!g || !c) return;
        g.style.left = c.sx + 'px'; g.style.top = c.sy + 'px'; g.style.display = 'block';
        const pin = g.querySelector('.pin');
        if (a.tx != null) { const t = cfg.project(a.tx, a.ty);   // aim the teardrop's sharp corner (at 135° when unrotated) toward the item
          pin.style.transform = 'rotate(' + (Math.atan2(t.sy - c.sy, t.sx - c.sx) * 180 / Math.PI - 135) + 'deg)'; g.classList.remove('circle'); }
        else { pin.style.transform = 'none'; g.classList.add('circle'); }   // nothing near → a plain circle
      });
      surface.addEventListener('pointerleave', () => hideGhost());
      if (config.button) config.button.onclick = () => {
        if (canComment()) { setPlacing(!placing); return; }
        if (canSignIn()) openSignin();   // logged out → inline sign-in popover
      };
      if (config.onViewChange) config.onViewChange(renderMarkers);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSignin(); if (placing) setPlacing(false); else closePanel(); } });
      // Auth changes flip the composer between sign-in prompt and input, and may
      // reveal comments (rules can gate reads on sign-in) — re-render on both.
      // On account creation the anonymous uid is upgraded IN PLACE (same uid, now with a
      // real name/photo) — refresh this guest's past comments so they read as them.
      let _wasAnonUid = null;
      if (cfg.identity && cfg.identity.subscribe) cfg.identity.subscribe(() => {
        const u = idUser();
        if (u) closeSignin();
        if (u && u.anonymous) _wasAnonUid = u.uid;
        else if (u && _wasAnonUid === u.uid && !u.anonymous) {
          _wasAnonUid = null;
          for (const t of threads) {
            let changed = false;
            const ms = (t.messages || []).map(m => {
              if (m.authorUid !== u.uid || (m.author === u.name && m.photo === u.photo)) return m;
              changed = true;
              const nm = { ...m, author: u.name };
              if (u.photo) nm.photo = u.photo;
              return nm;
            });
            if (changed) Promise.resolve(store.update(t.id, { messages: ms }, ctx())).then(() => reload(), e => fail('update', e));
          }
        }
        applyPerms(); refreshPanel();
      });
      document.addEventListener('pointerdown', e => { const p = $('cmt-signin-pop'); if (p && p.style.display === 'block' && !p.contains(e.target) && e.target !== cfg.button && !(cfg.button && cfg.button.contains(e.target))) closeSignin(); });
      // Role/membership changes (invite, promote, remove) update the chrome + panel live.
      if (cfg.permissions && cfg.permissions.subscribe) cfg.permissions.subscribe(() => { applyPerms(); refreshPanel(); });
      applyPerms();
      resubscribe();
    },
    isPlacing: () => placing,
    place(cx, cy) { if (!placing) return; const a = cfg.resolveAnchor(cx, cy); if (!a) return; setPlacing(false); openDraft(a); },
    reproject() { renderMarkers(); },
    countFor(c) { return store && store.countFor ? store.countFor(c) : 0; },   // thread count for a context
    // Live per-context counts for badges across a whole doc. cb({ context: [rev,…] })
    // fires now and on every change; re-binds automatically to a new store/backend.
    watchCounts(prefix, cb) { countWatch = { prefix, cb }; startCountWatch(); },
    setContext() { closePanel(); resubscribe(); },   // call after the storage context (e.g. sheet) changes
    setStore(s) { store = defineBackend({ store: s }).store; resubscribe(); startCountWatch(); },
    // Attach a backend { store, identity, permissions } AFTER init — for hosts
    // (e.g. single-file viewers) that load their backend asynchronously and start
    // on the default store. Upgrades the live overlay to platform mode.
    setBackend(backend) {
      if (!cfg || !backend) return;
      const b = defineBackend(backend);
      if (b.store) store = b.store;
      if (b.identity) { cfg.identity = b.identity; if (b.identity.subscribe) b.identity.subscribe(() => { if (idUser()) closeSignin(); applyPerms(); refreshPanel(); }); }
      if (b.permissions) { cfg.permissions = b.permissions; if (b.permissions.subscribe) b.permissions.subscribe(() => { applyPerms(); refreshPanel(); }); }
      applyPerms(); refreshPanel(); resubscribe(); startCountWatch();
    },
    toggle() { setPlacing(!placing); },
    // What the attached backend supports: { realtime, counts, identity, signIn, permissions }.
    capabilities() { return defineBackend({ store, identity: cfg && cfg.identity, permissions: cfg && cfg.permissions }).capabilities; },
    screenOffset,   // exposed for the window.Comments global path (also a named module export)
  };
}

export default createComments;

// Global convenience: a shared singleton on window for non-bundled module scripts
// (`<script type="module" src="comments.js">` then `window.Comments.init(...)`).
if (typeof window !== 'undefined' && !window.Comments) {
  window.Comments = createComments();
  window.createComments = createComments;
}
