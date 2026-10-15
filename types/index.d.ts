// Type declarations for canvas-comments-kit. The runtime is plain JS; these describe
// the scene adapter and the backend contract so a TypeScript backend can be checked.

export type Context = string;
export type MaybePromise<T> = T | Promise<T>;
export type Unsubscribe = () => void;

/** Where a thread is pinned, in your scene's world coordinates. */
export interface Anchor {
  /** Your category ('part', 'point', 'shape', …); informational. */
  kind: string;
  x: number;
  y: number;
  /** Stable id of the object the comment is about. */
  ref?: string;
  /** Thread title ('Line L3', 'Open space'). */
  label?: string;
  /** World point the pin aims at; present → teardrop marker, absent → circle. */
  tx?: number;
  ty?: number;
  /** Screen-pixel offset from the projected (tx, ty); see screenOffset(). */
  off?: { dx: number; dy: number } | null;
  [extra: string]: unknown;
}

export interface Message {
  id: string;
  author: string;
  text: string;
  /** Epoch ms (anything `new Date()` accepts renders). */
  ts: number;
  authorUid?: string;
  photo?: string;
  [extra: string]: unknown;
}

export interface Thread {
  id: string;
  anchor: Anchor;
  resolved: boolean;
  ts: number;
  messages: Message[];
  /** Revision the thread was authored on (rev-aware hosts only). */
  rev?: number | string | null;
  [extra: string]: unknown;
}

/** { context: [rev|null, …] } — one entry per unresolved thread. */
export type ContextCounts = Record<Context, Array<number | string | null>>;

/**
 * Persistence. The overlay passes the current context as the LAST argument of every
 * call; a store that binds its own context may ignore it.
 */
export interface Store {
  list(context?: Context): MaybePromise<Thread[]>;
  /** Return the saved thread to adopt a server-assigned id. */
  addThread(thread: Thread, context?: Context): MaybePromise<Thread | void>;
  addReply(threadId: string, message: Message, context?: Context): MaybePromise<Message | void>;
  update(threadId: string, patch: Partial<Thread>, context?: Context): MaybePromise<void>;
  remove(threadId: string, context?: Context): MaybePromise<void>;
  /** Realtime: cb fires now and on every change; replaces list() polling. */
  subscribe?(cb: (threads: Thread[]) => void, context?: Context): Unsubscribe;
  /** Sync unresolved count for any context (badges). */
  countFor?(context: Context): number;
  /** Live per-context counts for every context starting with prefix. */
  countsByContext?(prefix: string, cb: (counts: ContextCounts) => void): Unsubscribe;
}

export interface User {
  name: string;
  uid?: string;
  photo?: string;
  email?: string;
  /** A guest with a real uid; the composer asks for a display name. */
  anonymous?: boolean;
}

export interface Identity {
  current(): User | null;
  signIn?(): Promise<unknown>;
  signOut?(): Promise<unknown>;
  subscribe?(cb: (user: User | null) => void): Unsubscribe;
  /** Render an inline sign-in button into el (used by the sign-in popover). */
  renderSignIn?(el: HTMLElement): unknown;
}

export interface Permissions {
  /** May place / reply / resolve. Default true. */
  canComment?(): boolean;
  /** May delete others' threads. Default false. */
  canModerate?(): boolean;
  role?(): string | null;
  subscribe?(cb: (role?: string | null) => void): Unsubscribe;
}

export interface Backend {
  store?: Store;
  identity?: Identity;
  permissions?: Permissions;
  /** Extra keys (SDK handles, admin APIs) are allowed and ignored. */
  [extra: string]: unknown;
}

export interface Capabilities {
  realtime: boolean;
  counts: boolean;
  identity: boolean;
  signIn: boolean;
  permissions: boolean;
}

export interface DefinedBackend {
  store?: Store;
  identity?: Identity;
  permissions?: Permissions;
  capabilities: Capabilities;
}

export type BackendOp = 'list' | 'subscribe' | 'addThread' | 'addReply' | 'update' | 'remove';

export interface CommentsConfig {
  /** Storage scope; call setContext() after it changes. */
  context?: Context | (() => Context);
  /** Element pointer events fire on (SVG or <canvas>). */
  surface: Element;
  /** position:relative container the overlay is appended to. */
  stage: HTMLElement;
  /** Optional toolbar toggle; gets `.on` while placing. */
  button?: HTMLElement | null;
  /** World → screen (px, relative to stage). */
  project(x: number, y: number): { sx: number; sy: number } | null;
  /** Hit-test at a viewport pixel. */
  resolveAnchor(clientX: number, clientY: number): Anchor | null;
  /** Register a callback to run on every pan/zoom. */
  onViewChange?(cb: () => void): void;
  onChange?(): void;
  /** A backend call failed. Without it, failures are console.warn'd. */
  onError?(error: unknown, op: BackendOp): void;
  backend?: Backend;
  /** Shorthand for backend.store (wins over backend.store). */
  store?: Store;
  identity?: Identity;
  permissions?: Permissions;
  /** Rev-aware hosts: the revision being viewed / the latest / the one diffed against. */
  rev?(): number | string | null;
  latestRev?(): number | string | null;
  diffRev?(): number | string | null;
}

export interface CommentsController {
  init(config: CommentsConfig): void;
  isPlacing(): boolean;
  place(clientX: number, clientY: number): void;
  reproject(): void;
  toggle(): void;
  setContext(): void;
  setStore(store: Store): void;
  setBackend(backend: Backend): void;
  capabilities(): Capabilities;
  countFor(context: Context): number;
  watchCounts(prefix: string, cb: (counts: ContextCounts) => void): void;
  screenOffset: typeof screenOffset;
}

export function createComments(): CommentsController;
export default createComments;

export function screenOffset(
  project: CommentsConfig['project'],
  cursorSx: number, cursorSy: number,
  tx: number | null | undefined, ty: number | null | undefined,
  gap?: number,
): { dx: number; dy: number } | null;

export const CONTRACT: Record<'store' | 'identity' | 'permissions', { required: string[]; optional: string[] }>;
export function defineBackend(backend?: Backend): DefinedBackend;

type BoundContext = Context | (() => Context);

export function localStorageBackend(opts?: { context?: BoundContext; prefix?: string }): { store: Required<Pick<Store, 'countFor' | 'countsByContext'>> & Store };
export function makeLocalStore(context?: BoundContext, opts?: { prefix?: string }): Store;

export function memoryBackend(opts?: {
  context?: BoundContext;
  threads?: Record<Context, Thread[]>;
  latency?: number;
}): { store: Required<Store>; dump(): Record<Context, Thread[]> };

export interface HttpRoute { method: string; path: string }
export function httpBackend(opts: {
  baseUrl: string;
  context?: BoundContext;
  headers?: Record<string, string> | (() => MaybePromise<Record<string, string>>);
  fetch?: typeof fetch;
  poll?: number;
  counts?: boolean;
  routes?: Partial<{
    list(context: Context): HttpRoute;
    addThread(context: Context): HttpRoute;
    addReply(threadId: string, context: Context): HttpRoute;
    update(threadId: string, context: Context): HttpRoute;
    remove(threadId: string, context: Context): HttpRoute;
    counts(prefix: string): HttpRoute;
  }>;
}): { store: Store; request(route: HttpRoute, body?: unknown): Promise<any> };

export function checkStore(store: Store, opts?: { context?: Context; timeout?: number }): Promise<{
  ok: boolean;
  results: Array<{ name: string; ok: boolean; error?: string }>;
}>;
