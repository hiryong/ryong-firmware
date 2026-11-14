// The board-3D page's data, fetched once per page load and shared: the footer link warms it (on hover,
// focus, or when the browser is idle) so the 3D view opens with everything already downloaded.
// Kept free of three.js so warming it costs only the downloads; the page itself turns the bytes into meshes.
// The texture and model files have content-hashed names and are cached by the browser for good
// (public/_headers), so on later visits this is read from the disk cache.

export const BOARD3D_SRC = "/board3d/ryong60/";

type ModelEntry = { file: string; refs: string[]; centred?: boolean };
export type Board3DData = {
  board: Promise<unknown>;
  models: Promise<ModelEntry[]>;
  /** the raw bytes of each model file, by file name */
  bytes: (file: string) => Promise<ArrayBuffer>;
};

const cache = new Map<string, Board3DData>();

export function board3dData(src = BOARD3D_SRC): Board3DData {
  const hit = cache.get(src);
  if (hit) return hit;
  const bytesOf = new Map<string, Promise<ArrayBuffer>>();
  const bytes = (file: string) => {
    let p = bytesOf.get(file);
    if (!p) { p = fetch(src + file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))); bytesOf.set(file, p); }
    return p;
  };
  const board = fetch(src + "board.json").then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  const models = fetch(src + "models.json").then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] }))
    .then(({ models }: { models: ModelEntry[] }) => { for (const m of models) bytes(m.file).catch(() => {}); return models; });
  // the board textures: fetched into the HTTP cache so the image loader finds them there
  board.then((b) => {
    const tx = (b as { textures?: Record<string, string> }).textures ?? {};
    for (const f of Object.values(tx)) fetch(src + f).catch(() => {});
  }, () => {});
  const d = { board, models, bytes };
  board.catch(() => cache.delete(src)); // let a later open try again
  cache.set(src, d);
  return d;
}

/** Start the 3D page's downloads (data and its code) ahead of opening it. */
export function warmBoard3D() {
  board3dData();
  import("./Board3D").catch(() => {});
}

/** Warm it once the page is idle, unless the visitor asked to save data or is on a slow link. */
export function warmBoard3DWhenIdle() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (c?.saveData || (c?.effectiveType && !/4g/.test(c.effectiveType))) return;
  const go = () => warmBoard3D();
  const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  setTimeout(() => (ric ? ric(go, { timeout: 5000 }) : go()), 4000);
}
