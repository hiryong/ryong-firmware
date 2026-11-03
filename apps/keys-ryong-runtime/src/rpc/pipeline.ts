// Studio RPC with several requests on the wire at once (Ryong).
//
// The stock client sends one request and waits for its answer before the next. Over Bluetooth every
// answer costs a few connection events, so loading a keymap (hundreds of small requests) took 25-40 s
// although it is only ~30 KB. The keyboard handles requests strictly in order and answers in order,
// so we keep up to WINDOW requests outstanding and match answers by request id.
//
// Answers that cannot change while connected (the behavior list and each behavior's details) are
// remembered per connection: several parts of the app ask for them.
import {
  MetaError,
  NoResponseError,
  type Request,
  type RequestResponse,
  type RpcConnection,
} from "@zmkfirmware/zmk-studio-ts-client/index";

export { MetaError, NoResponseError };

/* Small enough that the keyboard's receive queue (16 reports) never overflows. */
const WINDOW = 4;

type Pending = { resolve: (r: RequestResponse) => void; reject: (e: unknown) => void };
type State = {
  pending: Map<number, Pending>;
  inflight: number;
  waiters: (() => void)[];
  writing: Promise<void>;
  dead?: unknown;
  cache: Map<string, Promise<RequestResponse>>;
};

const states = new WeakMap<RpcConnection, State>();

function stateFor(conn: RpcConnection): State {
  let s = states.get(conn);
  if (s) return s;
  const st: State = { pending: new Map(), inflight: 0, waiters: [], writing: Promise.resolve(), cache: new Map() };
  states.set(conn, st);
  const reader = conn.request_response_readable.getReader();
  const fail = (e: unknown) => {
    st.dead = e ?? "No response";
    for (const p of st.pending.values()) p.reject(st.dead);
    st.pending.clear();
    st.waiters.splice(0).forEach((w) => w());
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
  if (b && (b.listAllBehaviors || b.getBehaviorDetails)) return JSON.stringify(b);
  return undefined;
}

async function send(conn: RpcConnection, st: State, req: Omit<Request, "requestId">): Promise<RequestResponse> {
  while (st.inflight >= WINDOW && !st.dead) await new Promise<void>((r) => st.waiters.push(r));
  if (st.dead) throw st.dead;
  st.inflight++;
  const request = { ...req, requestId: conn.current_request++ } as Request;
  const answer = new Promise<RequestResponse>((resolve, reject) => st.pending.set(request.requestId, { resolve, reject }));
  const write = st.writing.then(async () => {
    const writer = conn.request_writable.getWriter();
    try { await writer.write(request); } finally { writer.releaseLock(); }
  });
  st.writing = write.catch(() => {});
  try {
    await write;
    return await answer;
  } catch (e) {
    st.pending.delete(request.requestId);
    throw e;
  } finally {
    st.inflight--;
    st.waiters.shift()?.();
  }
}

/** Same contract as the stock call_rpc: resolves with the answer, throws on errors. */
export function call_rpc(conn: RpcConnection, req: Omit<Request, "requestId">): Promise<RequestResponse> {
  const st = stateFor(conn);
  const key = cacheKey(req);
  if (!key) return send(conn, st, req);
  const hit = st.cache.get(key);
  if (hit) return hit;
  const p = send(conn, st, req);
  st.cache.set(key, p);
  p.catch(() => st.cache.delete(key)); // never remember a failure
  return p;
}
