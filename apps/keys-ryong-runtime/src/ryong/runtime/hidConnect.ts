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

async function pick(hid: Hid): Promise<HidDevice> {
  // Already allowed on this site: connect without asking again.
  const known = (await hid.getDevices()).filter(isStudio);
  if (known.length === 1) return known[0];
  let chosen: HidDevice[];
  try { chosen = await hid.requestDevice({ filters: [{ usagePage: STUDIO_USAGE_PAGE, usage: STUDIO_USAGE }] }); }
  catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") throw new UserCancelledError("User cancelled the connection attempt", { cause: e });
    throw e;
  }
  const d = chosen.find(isStudio);
  if (!d) throw new Error(NOT_FOUND());
  return d;
}

export async function connect(): Promise<RpcTransport> {
  const hid = webHid();
  if (!hid) throw new Error(t("This browser has no WebHID. Use Chrome or Edge.", "이 브라우저는 WebHID를 지원하지 않아요. Chrome이나 Edge를 쓰세요."));
  const dev = await pick(hid);
  if (!dev.opened) await dev.open();
  Object.assign(hidStats, { active: true, writes: 0, bytesIn: 0, bytesOut: 0, waits: 0, waitMs: 0, maxWaitMs: 0, start: performance.now(), last: performance.now() });
  bump();
  const label = dev.productName || "Keyboard";
  const size = reportSizeOf(dev);
  const abortController = new AbortController();
  let onReport: ((e: Event) => void) | undefined;
  let onGone: ((e: Event) => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
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
  let sending = Promise.resolve();
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      // Reports go out in order, one at a time.
      sending = sending.then(async () => {
        for (const r of toReports(chunk, size)) await dev.sendReport(STUDIO_REPORT_ID, r);
        hidStats.writes++; hidStats.bytesOut += chunk.length; if (!pendingSince) pendingSince = performance.now(); bump();
      });
      return sending;
    },
  });
  const sig = abortController.signal;
  const abort = () => { sig.removeEventListener("abort", abort); cleanup(); hidStats.active = false; bump(); dev.close().catch(() => {}); };
  sig.addEventListener("abort", abort);
  return { label, abortController, readable, writable };
}
