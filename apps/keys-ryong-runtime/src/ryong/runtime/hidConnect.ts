// ZMK Studio over WebHID (Ryong firmware): reaches the keyboard while it stays connected to the
// computer, over Bluetooth or USB. Web Bluetooth cannot see an already-connected keyboard on
// Windows/macOS; WebHID opens it like any other HID device.
//
// Firmware side: third_party/zmk patch, app/src/studio/hid_rpc_transport.c. One vendor collection
// (usage page 0xFF5A, usage 1), report 0x10, N bytes both ways: byte 0 = valid length (0..N-1),
// then the Studio byte stream (same framing as serial and GATT). N is read from the device's report
// descriptor (60 since firmware da1af7b+1, 32 before).
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { t } from "../i18n";
import { create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";
import { call_rpc as raw_rpc } from "../../rpc/pipeline";

export const STUDIO_USAGE_PAGE = 0xff5a;
export const STUDIO_USAGE = 0x01;
export const STUDIO_REPORT_ID = 0x10;
export const REPORT_SIZE = 32; /* older firmware; newer ones say their size in the descriptor */

/* Minimal WebHID typing (not in TypeScript's DOM lib). */
type HidReportInfo = { reportId: number; items?: { reportSize: number; reportCount: number }[] };
type HidCollection = { usagePage: number; usage: number; outputReports?: HidReportInfo[] };
export type HidDevice = EventTarget & {
  opened: boolean; productName: string; collections: HidCollection[];
  open(): Promise<void>; close(): Promise<void>; sendReport(id: number, data: BufferSource): Promise<void>;
};
type Hid = EventTarget & {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(o: { filters: { usagePage?: number; usage?: number }[] }): Promise<HidDevice[]>;
};
export const webHid = (): Hid | undefined => (navigator as unknown as { hid?: Hid }).hid;

/** Live numbers for the current WebHID connection, shown on the workspace header (diagnosis of speed). */
export const hidStats = { active: false, writes: 0, bytesIn: 0, bytesOut: 0, waits: 0, waitMs: 0, maxWaitMs: 0, start: 0, last: 0 };
const statListeners = new Set<() => void>();
let statVersion = 0;
const bump = () => { statVersion++; statListeners.forEach((f) => f()); };
export const subscribeHidStats = (f: () => void) => { statListeners.add(f); return () => statListeners.delete(f); };
export const hidStatsVersion = () => statVersion;
let pendingSince = 0;

const isStudio = (d: HidDevice) => d.collections.some((c) => c.usagePage === STUDIO_USAGE_PAGE && c.usage === STUDIO_USAGE);

/** Studio report size from the device's descriptor (bytes, without the report ID). */
export function reportSizeOf(d: HidDevice): number {
  for (const c of d.collections) {
    if (c.usagePage !== STUDIO_USAGE_PAGE) continue;
    const rep = c.outputReports?.find((r) => r.reportId === STUDIO_REPORT_ID);
    const bits = rep?.items?.reduce((n, it) => n + it.reportSize * it.reportCount, 0) ?? 0;
    if (bits >= 16 && bits % 8 === 0) return bits / 8;
  }
  return REPORT_SIZE;
}

/** Split a Studio byte stream into report bodies. */
export function toReports(chunk: Uint8Array, size = REPORT_SIZE): Uint8Array[] {
  const out: Uint8Array[] = [];
  const PAYLOAD = size - 1;
  for (let i = 0; i < chunk.length; i += PAYLOAD) {
    const part = chunk.subarray(i, i + PAYLOAD);
    const body = new Uint8Array(size);
    body[0] = part.length;
    body.set(part, 1);
    out.push(body);
  }
  return out;
}

/** Bytes carried by one input report body. */
export function fromReport(view: DataView): Uint8Array {
  const n = Math.min(view.getUint8(0), view.byteLength - 1);
  return new Uint8Array(view.buffer, view.byteOffset + 1, n).slice();
}

const NOT_FOUND = () => t(
  "No keyboard found. Install the newest Ryong firmware, then remove the keyboard in the computer's Bluetooth settings and pair it again (the computer has to re-read the keyboard once).",
  "키보드를 찾지 못했어요. 최신 Ryong 펌웨어를 설치한 뒤, 컴퓨터의 블루투스 설정에서 키보드를 지우고 다시 페어링하세요 (컴퓨터가 키보드 정보를 한 번 새로 읽어야 해요).");

function request(hid: Hid): Promise<HidDevice> {
  return hid.requestDevice({ filters: [{ usagePage: STUDIO_USAGE_PAGE, usage: STUDIO_USAGE }] }).then((chosen) => {
    const d = chosen.find(isStudio);
    if (!d) throw new Error(NOT_FOUND());
    return d;
  }, (e) => {
    if (e instanceof DOMException && e.name === "NotFoundError") throw new UserCancelledError("User cancelled the connection attempt", { cause: e });
    throw e;
  });
}

/**
 * The keyboard's own name. Windows gives the browser no name for a Bluetooth LE keyboard
 * (HidD_GetProductString is not supported for BLE HID, so Chrome lists it as "Unknown device
 * (1D50:615E)"); the keyboard itself knows it, so ask it (Studio core.getDeviceInfo needs no unlock).
 */
export async function nameOf(dev: HidDevice): Promise<string> {
  if (dev.productName) return dev.productName;
  const wasOpen = dev.opened;
  let tr: RpcTransport | undefined;
  try {
    tr = await openTransport(dev, false);
    const conn = create_rpc_connection(tr, { signal: tr.abortController.signal });
    const r = await Promise.race([raw_rpc(conn, { core: { getDeviceInfo: true } }), new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 4000))]);
    return r?.core?.getDeviceInfo?.name ?? "";
  } catch { return ""; }
  finally { tr?.abortController.abort(); if (!wasOpen) await dev.close().catch(() => {}); }
}

/** More than one keyboard allowed on this site: ask which one, by its own name. */
function choose(hid: Hid, known: HidDevice[]): Promise<HidDevice> {
  return new Promise((resolve, reject) => {
    const dlg = document.createElement("dialog");
    dlg.className = "ry-solid ry-kbpick";
    dlg.innerHTML = `<h2></h2><p class="ry-faint"></p><div class="ry-kbpick-list"></div><div class="ry-kbpick-foot"><button class="ry-text" data-add></button><button class="ry-outline" data-cancel></button></div>`;
    dlg.querySelector("h2")!.textContent = t("Which keyboard?", "어느 키보드에 연결할까요?");
    dlg.querySelector("p")!.textContent = t("Keyboards this site may use, by their own names.", "이 사이트에서 쓸 수 있는 키보드예요. 키보드가 알려 준 이름으로 보여요.");
    const list = dlg.querySelector(".ry-kbpick-list")!;
    let done = false;
    const finish = (f: () => void) => { if (done) return; done = true; dlg.close(); dlg.remove(); f(); };
    known.forEach((d, i) => {
      const b = document.createElement("button");
      b.className = "ry-kbpick-item";
      b.textContent = d.productName || t("Checking the name…", "이름 확인 중…");
      b.onclick = () => finish(() => resolve(d));
      list.appendChild(b);
      if (!d.productName) void nameOf(d).then((n) => { b.textContent = n || t("Keyboard {n}", "키보드 {n}", { n: i + 1 }); });
    });
    const add = dlg.querySelector<HTMLButtonElement>("[data-add]")!;
    add.textContent = t("Another keyboard…", "다른 키보드 추가…");
    add.onclick = () => finish(() => request(hid).then(resolve, reject));
    const cancel = dlg.querySelector<HTMLButtonElement>("[data-cancel]")!;
    cancel.textContent = t("Cancel", "취소");
    cancel.onclick = () => finish(() => reject(new UserCancelledError("User cancelled the connection attempt", { cause: undefined })));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); cancel.click(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

async function pick(hid: Hid): Promise<HidDevice> {
  // Already allowed on this site: our own list, with each keyboard's own name (the browser's list
  // can't name a Bluetooth keyboard on Windows) and "another keyboard" for one not allowed yet.
  const known = (await hid.getDevices()).filter(isStudio);
  if (known.length) return choose(hid, known);
  return request(hid);
}

export async function connect(): Promise<RpcTransport> {
  const hid = webHid();
  if (!hid) throw new Error(t("This browser has no WebHID. Use Chrome or Edge.", "이 브라우저는 WebHID를 지원하지 않아요. Chrome이나 Edge를 쓰세요."));
  return openTransport(await pick(hid));
}

export async function openTransport(dev: HidDevice, stats = true): Promise<RpcTransport> {
  const hid = webHid()!;
  if (!dev.opened) await dev.open();
  if (stats) Object.assign(hidStats, { active: true, writes: 0, bytesIn: 0, bytesOut: 0, waits: 0, waitMs: 0, maxWaitMs: 0, start: performance.now(), last: performance.now() });
  if (stats) bump();
  const label = dev.productName || "Keyboard";
  const size = reportSizeOf(dev);
  const abortController = new AbortController();
  let onReport: ((e: Event) => void) | undefined;
  let onGone: ((e: Event) => void) | undefined;
  let rd: ReadableStreamDefaultController<Uint8Array> | undefined;
  /* End the incoming stream so the app sees the connection is gone (it waits on it). */
  const endReadable = (e?: unknown) => { try { if (e) rd?.error(e); else rd?.close(); } catch { /* already ended */ } };
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      rd = controller;
      onReport = (e: Event) => {
        const ev = e as Event & { reportId: number; data: DataView };
        if (ev.reportId !== STUDIO_REPORT_ID) return;
        const bytes = fromReport(ev.data);
        if (bytes.length) {
          const now = performance.now();
          if (pendingSince) { const w = now - pendingSince; hidStats.waits++; hidStats.waitMs += w; hidStats.maxWaitMs = Math.max(hidStats.maxWaitMs, w); pendingSince = 0; }
          hidStats.bytesIn += bytes.length; hidStats.last = now; bump();
          controller.enqueue(bytes);
        }
      };
      onGone = (e: Event) => {
        if ((e as Event & { device: HidDevice }).device !== dev) return;
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };
      dev.addEventListener("inputreport", onReport);
      hid.addEventListener("disconnect", onGone);
    },
  });
  const cleanup = () => {
    if (onReport) dev.removeEventListener("inputreport", onReport);
    if (onGone) hid.removeEventListener("disconnect", onGone);
  };
  // Requests written in the same moment are packed into full reports: each report is one Bluetooth
  // write (one round trip on a Mac), and the keyboard reads the bytes as a stream anyway.
  let queued: Uint8Array[] = [];
  let sending: Promise<void> | undefined;
  let failure: unknown;
  const flush = async () => {
    while (queued.length) {
      await new Promise((r) => setTimeout(r, 0)); // let the other requests of this moment arrive
      const parts = queued; queued = [];
      const total = parts.reduce((n, p) => n + p.length, 0);
      const all = new Uint8Array(total); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      for (const r of toReports(all, size)) await dev.sendReport(STUDIO_REPORT_ID, r);
      hidStats.writes += parts.length; hidStats.bytesOut += total; if (!pendingSince) pendingSince = performance.now(); bump();
    }
  };
  const kick = () => {
    sending ??= flush().catch((e) => { failure = e; endReadable(e); }).finally(() => { sending = undefined; if (queued.length && !failure) kick(); });
  };
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (failure) throw failure;
      queued.push(chunk.slice());
      kick();
    },
    async close() { await sending; },
  });
  const sig = abortController.signal;
  const abort = () => { sig.removeEventListener("abort", abort); cleanup(); endReadable(); if (stats) { hidStats.active = false; bump(); } dev.close().catch(() => {}); };
  sig.addEventListener("abort", abort);
  return { label, abortController, readable, writable };
}
