// Studio RPC with several requests on the wire at once (Ryong).
//
// The stock client sends one request and waits for its answer before the next. Over Bluetooth every
// answer costs a few connection events, so loading a keymap (hundreds of small requests) took 25-40 s
// although it is only ~30 KB. The keyboard reads requests as one byte stream and answers in order,
// so many requests go out back to back (the WebHID transport packs them into full reports) and
// answers are matched by request id. Limits: WINDOW requests and BYTE_BUDGET encoded bytes in flight,
// small enough for the keyboard's receive queue.
//
// Answers that cannot change while connected (behavior catalog, device info, subsystem list) are
// remembered per connection; identical reads already in flight are shared (several parts of the
// app ask for the keymap, layouts and lock state at the same moment).
import {
  MetaError,
  NoResponseError,
  Request,
  type RequestResponse,
  type RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client/index";

export { MetaError, NoResponseError };

const WINDOW = 32;
/* Requests not yet answered, in encoded bytes: the keyboard buffers ~16 reports of 31 bytes
 * (older firmware) before its RPC thread reads them. */
const BYTE_BUDGET = 400;

type Pending = { resolve: (r: RequestResponse) => void; reject: (e: unknown) => void };
type State = {
  pending: Map<number, Pending>;
  inflight: number;
  inflightBytes: number;
  writer?: WritableStreamDefaultWriter<Request>;
  shared: Map<string, Promise<RequestResponse>>;
  queue: { size: number; go: () => void }[]; /* waiting to be sent, in call order */
  dead?: unknown;
  cache: Map<string, Promise<RequestResponse>>;
  fail: (e: unknown) => void;
  /* An UNLOCKED lock state answered a moment ago, reused until anything else is sent. */
  recent: Map<string, { at: number; p: Promise<RequestResponse> }>;
  catalog?: Promise<Catalog | null>;
};

/** Which requests a load spends its time on (shown with the Bluetooth timing). */
export const requestCounts = new Map<string, number>();
function countRequest(req: Omit<Request, "requestId">) {
  const r = req as unknown as Record<string, Record<string, unknown> | undefined>;
  const top = Object.keys(r).find((k) => k !== "requestId" && r[k] !== undefined);
  const sub = top ? Object.keys(r[top]!).find((k) => r[top]![k] !== undefined) : undefined;
  const custom = (req as { custom?: { call?: { subsystemIndex: number } } }).custom?.call;
  const name = custom ? `custom#${custom.subsystemIndex}` : `${top}.${sub}`;
  requestCounts.set(name, (requestCounts.get(name) ?? 0) + 1);
}

/* ---- Behavior catalog remembered across visits, per firmware build ----
 * Each behavior's details cost one request; a keyboard has dozens. They only change with the
 * firmware, so they are kept in the browser under the build ID the keyboard reports. */
type Catalog = { key: string; data: Record<number, unknown> };
const CATALOG_PREFIX = "ryong.behaviorCatalog.v1:";
function loadCatalog(key: string): Catalog {
  try { return { key, data: JSON.parse(localStorage.getItem(key) ?? "{}") }; } catch { return { key, data: {} }; }
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveCatalog(c: Catalog) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(c.key, JSON.stringify(c.data));
      const keys = Object.keys(localStorage).filter((k) => k.startsWith(CATALOG_PREFIX) && k !== c.key);
      for (const k of keys.slice(0, Math.max(0, keys.length - 2))) localStorage.removeItem(k); // keep three builds
    } catch { /* storage full or blocked: just ask the keyboard next time */ }
  }, 500);
}
async function catalogFor(conn: RpcConnection, list: Promise<RequestResponse>): Promise<Catalog | null> {
  const ids = (await list).behaviors?.listAllBehaviors?.behaviors;
  if (!ids?.length) return null;
  const { firmwareDevice } = await import("../ryong/runtime/updateDevice");
  const id = await (await firmwareDevice(conn)).identity();
  if (!id.buildId) return null;
  return loadCatalog(`${CATALOG_PREFIX}${id.model}:${id.buildId}:${ids.join(",")}`);
}

/** Longest wait for one answer. Saves write flash and can take a while over Bluetooth. */
function timeoutFor(req: Omit<Request, "requestId">): number {
  if (req.keymap?.saveChanges || (req as { custom?: unknown }).custom) return 30000;
  return 10000;
}

export class RpcTimeoutError extends Error {
  constructor() { super("The keyboard stopped answering."); }
}

/** Close a connection cleanly (the request stream is held by this module). */
export async function closeConnection(conn: RpcConnection, reason: unknown = "User disconnected") {
  const st = states.get(conn);
  if (!st) { await conn.request_writable.close().catch(() => {}); return; }
  const w = st.writer;
  st.fail(reason);
  if (w) await w.close().catch(() => {});
}

const states = new WeakMap<RpcConnection, State>();

function stateFor(conn: RpcConnection): State {
  let s = states.get(conn);
  if (s) return s;
  const st: State = { fail: () => {}, recent: new Map(), pending: new Map(), inflight: 0, inflightBytes: 0, queue: [], cache: new Map(), shared: new Map() };
  states.set(conn, st);
  st.fail = (e) => fail(e);
  const reader = conn.request_response_readable.getReader();
  const fail = (e: unknown) => {
    if (st.dead) return;
    st.dead = e ?? "No response";
    // End the connection too: answers come in order, so after a lost one nothing would line up.
    // (Aborting the request stream makes the stock client abort the transport.)
    st.writer?.abort(st.dead).catch(() => {});
    for (const p of st.pending.values()) p.reject(st.dead);
    st.pending.clear();
    st.queue.splice(0).forEach((q) => { st.inflight++; st.inflightBytes += q.size; q.go(); });
  };
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) return fail("No response");
        const p = st.pending.get(value.requestId);
        if (!p) continue; // an answer nobody waits for (timed out elsewhere): ignore
        st.pending.delete(value.requestId);
        if (value.meta?.noResponse) p.reject(new NoResponseError());
        else if (value.meta?.simpleError) p.reject(new MetaError(value.meta.simpleError));
        else p.resolve(value);
      }
    } catch (e) {
      fail(e);
    }
  })();
  return st;
}

/** Requests whose answer is fixed for the life of a connection. */
function cacheKey(req: Omit<Request, "requestId">): string | undefined {
  const b = req.behaviors;
  if (b && (b.listAllBehaviors || b.getBehaviorDetails)) return "b" + JSON.stringify(b);
  if (req.core?.getDeviceInfo) return "deviceInfo";
  if (req.custom?.listCustomSubsystems) return "subsystems";
  return undefined;
}

/** Reads whose answer may change, but not between two identical asks in flight at once. */
function sharedKey(req: Omit<Request, "requestId">): string | undefined {
  if (req.core?.getLockState) return "lock";
  const k = req.keymap;
  if (k?.getKeymap) return "keymap";
  if (k?.getPhysicalLayouts) return "layouts";
  if (k?.checkUnsavedChanges) return "unsaved";
  return undefined;
}

/** Let queued requests go, oldest first, while they fit. */
function pump(st: State) {
  while (st.queue.length) {
    const head = st.queue[0];
    if (!st.dead && st.inflight > 0 && (st.inflight >= WINDOW || st.inflightBytes + head.size > BYTE_BUDGET)) return;
    st.queue.shift();
    st.inflight++; // reserved for it
    st.inflightBytes += head.size;
    head.go();
  }
}

async function send(conn: RpcConnection, st: State, req: Omit<Request, "requestId">): Promise<RequestResponse> {
  const request = { ...req, requestId: 0 } as Request;
  // Encoded size (+ framing). The custom subsystem payload is counted directly in case the Request
  // codec in use doesn't know the custom field.
  const custom = (req as { custom?: { call?: { payload?: Uint8Array } } }).custom?.call?.payload?.length ?? 0;
  const size = Math.max(Request.encode(request).finish().length, custom + 8) + 4;
  const fits = () => st.inflight === 0 || (st.inflight < WINDOW && st.inflightBytes + size <= BYTE_BUDGET);
  const queued = st.queue.length > 0 || !fits();
  if (queued) await new Promise<void>((go) => st.queue.push({ size, go })); // pump() reserves the slot
  else { st.inflight++; st.inflightBytes += size; }
  if (st.dead) { st.inflight--; st.inflightBytes -= size; throw st.dead; }
  request.requestId = conn.current_request++;
  const answer = new Promise<RequestResponse>((resolve, reject) => st.pending.set(request.requestId, { resolve, reject }));
  // One writer for the connection; writes are queued in order without waiting for each other, so
  // the transport can pack several requests into one report.
  st.writer ??= conn.request_writable.getWriter();
  const write = st.writer.write(request);
  const timer = setTimeout(() => st.fail(new RpcTimeoutError()), timeoutFor(req));
  try {
    await Promise.all([write, answer]);
    return await answer;
  } catch (e) {
    st.pending.delete(request.requestId);
    throw e;
  } finally {
    clearTimeout(timer);
    st.inflight--;
    st.inflightBytes -= size;
    pump(st);
  }
}

/** Same contract as the stock call_rpc: resolves with the answer, throws on errors. */
const RECENT_MS = 2000;

export function call_rpc(conn: RpcConnection, req: Omit<Request, "requestId">): Promise<RequestResponse> {
  const st = stateFor(conn);
  const key = cacheKey(req);
  if (key) {
    const hit = st.cache.get(key);
    if (hit) return hit;
    const detailsId = req.behaviors?.getBehaviorDetails?.behaviorId;
    const p = detailsId !== undefined && st.catalog ? fromCatalog(conn, st, req, detailsId) : sendCounted(conn, st, req);
    st.cache.set(key, p);
    p.catch(() => st.cache.delete(key)); // never remember a failure
    if (req.behaviors?.listAllBehaviors) st.catalog = catalogFor(conn, p).catch(() => null);
    return p;
  }
  const sk = sharedKey(req);
  if (sk) {
    const inFlight = st.shared.get(sk);
    if (inFlight) return inFlight;
    const recent = st.recent.get(sk);
    if (recent && performance.now() - recent.at < RECENT_MS) return recent.p;
    const p = sendCounted(conn, st, req);
    st.shared.set(sk, p);
    const done = () => { if (st.shared.get(sk) === p) st.shared.delete(sk); };
    p.then((r) => {
      done();
      // a lock state is only reused when UNLOCKED: an unlock must show at once
      // Only an UNLOCKED lock state is reused for a moment (an unlock must show at once; the keymap
      // can change behind the page's back, e.g. a keyboard restart discards unsaved edits).
      if (sk === "lock" && r.core?.getLockState === 1) st.recent.set(sk, { at: performance.now(), p });
    }, done);
    return p;
  }
  // may change what a read would answer: later reads ask again
  st.shared.clear();
  st.recent.clear();
  return sendCounted(conn, st, req);
}

function sendCounted(conn: RpcConnection, st: State, req: Omit<Request, "requestId">) {
  countRequest(req);
  return send(conn, st, req).catch((e) => {
    if (e instanceof MetaError) st.recent.delete("lock"); // e.g. locked meanwhile: ask again next time
    throw e;
  });
}

async function fromCatalog(conn: RpcConnection, st: State, req: Omit<Request, "requestId">, id: number): Promise<RequestResponse> {
  const catalog = await st.catalog;
  const known = catalog?.data[id];
  if (known) return { requestId: 0, behaviors: { getBehaviorDetails: known } } as unknown as RequestResponse;
  const r = await sendCounted(conn, st, req);
  if (catalog && r.behaviors?.getBehaviorDetails) { catalog.data[id] = r.behaviors.getBehaviorDetails; saveCatalog(catalog); }
  return r;
}
