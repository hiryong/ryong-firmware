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
};

const states = new WeakMap<RpcConnection, State>();

function stateFor(conn: RpcConnection): State {
  let s = states.get(conn);
  if (s) return s;
  const st: State = { pending: new Map(), inflight: 0, inflightBytes: 0, queue: [], cache: new Map(), shared: new Map() };
  states.set(conn, st);
  const reader = conn.request_response_readable.getReader();
  const fail = (e: unknown) => {
    st.dead = e ?? "No response";
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
  try {
    await Promise.all([write, answer]);
    return await answer;
  } catch (e) {
    st.pending.delete(request.requestId);
    throw e;
  } finally {
    st.inflight--;
    st.inflightBytes -= size;
    pump(st);
  }
}

/** Same contract as the stock call_rpc: resolves with the answer, throws on errors. */
export function call_rpc(conn: RpcConnection, req: Omit<Request, "requestId">): Promise<RequestResponse> {
  const st = stateFor(conn);
  const key = cacheKey(req);
  if (key) {
    const hit = st.cache.get(key);
    if (hit) return hit;
    const p = send(conn, st, req);
    st.cache.set(key, p);
    p.catch(() => st.cache.delete(key)); // never remember a failure
    return p;
  }
  const sk = sharedKey(req);
  if (sk) {
    const inFlight = st.shared.get(sk);
    if (inFlight) return inFlight;
    const p = send(conn, st, req);
    st.shared.set(sk, p);
    const done = () => { if (st.shared.get(sk) === p) st.shared.delete(sk); };
    p.then(done, done);
    return p;
  }
  st.shared.clear(); // may change what a read would answer: later reads ask again
  return send(conn, st, req);
}
