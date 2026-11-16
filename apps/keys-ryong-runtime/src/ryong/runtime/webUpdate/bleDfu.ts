/** Wireless firmware install from the browser: the Adafruit nRF52 bootloader's Bluetooth update,
 * which is Nordic's legacy DFU (SDK 11, "DFU version 0.5+"), not Secure DFU.
 * Protocol reference: Nordic Android-DFU-Library LegacyDfuImpl.java (opcodes, order, responses).
 * Application only: the start command always says "application" and never SoftDevice or bootloader.
 * Development tool: the package is the build's unsigned -bluetooth.zip, as with Nordic's own app.
 * Web Bluetooth exists only in Chromium browsers (Chrome, Edge, …), not in Safari or Firefox. */
import type {BleDfuPackage} from "./bleDfuPackage";

export const DFU_SERVICE = "00001530-1212-efde-1523-785feabcd123";
export const DFU_CONTROL_POINT = "00001531-1212-efde-1523-785feabcd123";
export const DFU_PACKET = "00001532-1212-efde-1523-785feabcd123";
export const DFU_VERSION = "00001534-1212-efde-1523-785feabcd123";

const OP = {start: 1, init: 2, receive: 3, validate: 4, activate: 5, prnRequest: 8, response: 0x10, prn: 0x11} as const;
const STATUS: Record<number, string> = {
  2: "invalid state", 3: "not supported", 4: "data size exceeds limit", 5: "CRC error", 6: "operation failed",
};
/** Image type in the start command: application only (1 = SoftDevice, 2 = bootloader are never sent). */
const APPLICATION = 4;
/** Bytes per packet write: the legacy bootloader's 23-byte ATT MTU. */
export const PACKET_BYTES = 20;
/** Packets between the bootloader's receipt notifications (Nordic: 10 or fewer for legacy targets). */
export const PACKETS_PER_RECEIPT = 10;

export interface DfuLink {
  /** write to the control point, with response */
  control(bytes: Uint8Array): Promise<void>;
  /** write to the packet characteristic, without response */
  packet(bytes: Uint8Array): Promise<void>;
  /** the next control-point notification */
  next(timeoutMs: number): Promise<Uint8Array>;
  /** the DFU version characteristic (5 = 0.5, 8 = 0.8), or null when the bootloader has none */
  version(): Promise<number | null>;
}

export type BleDfuStage = "starting" | "init" | "sending" | "validating" | "activating" | "done";

const u32 = (...values: number[]) => { const b = new Uint8Array(values.length * 4), v = new DataView(b.buffer); values.forEach((x, i) => v.setUint32(i * 4, x, true)); return b; };

async function expect(link: DfuLink, op: number, timeoutMs: number) {
  for (;;) {
    const n = await link.next(timeoutMs);
    if (n[0] === OP.prn) continue; // a late receipt; the response follows
    if (n[0] !== OP.response || n[1] !== op) throw Error(`Unexpected reply from the bootloader (${Array.from(n.slice(0, 3)).join(",")}).`);
    if (n[2] !== 1) throw Error(`The bootloader refused step ${op}: ${STATUS[n[2]] ?? "status " + n[2]}.`);
    return;
  }
}

/** Sends one application image. Never retries on its own: a failed step stops with the reason. */
export async function sendApplication(pkg: BleDfuPackage, link: DfuLink, progress: (stage: BleDfuStage, sent?: number, total?: number) => void) {
  const {application, init} = pkg, total = application.length;
  const version = await link.version();
  // 0.5 and later need the init packet this package carries; older bootloaders are not ours
  // read as one little-endian number: 5 = DFU 0.5, 8 = 0.8 (Nordic: "version >= 5 needs the init packet")
  if (version !== null && version < 5) throw Error(`This bootloader's update version (${version}) is too old.`);

  progress("starting");
  await link.control(new Uint8Array([OP.start, APPLICATION]));
  await link.packet(u32(0, 0, total)); // SoftDevice size, bootloader size, application size
  await expect(link, OP.start, 30000); // the bootloader erases the application area first

  progress("init");
  await link.control(new Uint8Array([OP.init, 0]));
  for (let at = 0; at < init.length; at += PACKET_BYTES) await link.packet(init.subarray(at, at + PACKET_BYTES));
  await link.control(new Uint8Array([OP.init, 1]));
  await expect(link, OP.init, 10000);

  await link.control(new Uint8Array([OP.prnRequest, PACKETS_PER_RECEIPT & 0xff, PACKETS_PER_RECEIPT >> 8]));
  await link.control(new Uint8Array([OP.receive]));
  progress("sending", 0, total);
  let packets = 0;
  for (let at = 0; at < total; at += PACKET_BYTES) {
    const chunk = application.subarray(at, at + PACKET_BYTES);
    await link.packet(chunk);
    packets++;
    const sent = at + chunk.length;
    if (packets % PACKETS_PER_RECEIPT === 0 && sent < total) {
      const r = await link.next(10000);
      if (r[0] === OP.response) throw Error(`The bootloader stopped the transfer: ${STATUS[r[2]] ?? "status " + r[2]}.`);
      const got = r[0] === OP.prn && r.length >= 5 ? new DataView(r.buffer, r.byteOffset).getUint32(1, true) : -1;
      if (got !== sent) throw Error(`The bootloader received ${got} bytes, not ${sent}. Stopped.`);
    }
    progress("sending", sent, total);
  }
  await expect(link, OP.receive, 20000);

  progress("validating");
  await link.control(new Uint8Array([OP.validate]));
  await expect(link, OP.validate, 10000);

  progress("activating");
  // the bootloader starts the new firmware at once and drops the connection
  await link.control(new Uint8Array([OP.activate])).catch(() => {});
  progress("done");
}

// ---- Web Bluetooth ----

type Gatt = {
  device: { name?: string; gatt?: { connected: boolean; disconnect(): void; connect(): Promise<unknown> }; addEventListener(t: string, f: () => void): void };
};
interface BluetoothChar extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<unknown>;
  writeValueWithResponse?(b: BufferSource): Promise<void>;
  writeValueWithoutResponse?(b: BufferSource): Promise<void>;
  writeValue(b: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
}

export const webBluetoothAvailable = () => typeof navigator !== "undefined" && "bluetooth" in navigator && window.isSecureContext;

/** Must run from a click: the browser shows its device chooser. Lists only keyboards waiting for an update. */
export async function connectWaitingKeyboard(): Promise<{ link: DfuLink; name: string; close(): void }> {
  const bt = (navigator as unknown as { bluetooth: { requestDevice(o: unknown): Promise<Gatt["device"]> } }).bluetooth;
  const device = await bt.requestDevice({filters: [{services: [DFU_SERVICE]}, {namePrefix: "AdaDFU"}, {namePrefix: "Ryong60DFU"}], optionalServices: [DFU_SERVICE]});
  const server = await device.gatt!.connect() as { getPrimaryService(u: string): Promise<{ getCharacteristic(u: string): Promise<BluetoothChar> }> };
  const service = await server.getPrimaryService(DFU_SERVICE);
  const cp = await service.getCharacteristic(DFU_CONTROL_POINT), pk = await service.getCharacteristic(DFU_PACKET);
  const ver = await service.getCharacteristic(DFU_VERSION).catch(() => null);
  const queue: Uint8Array[] = [];
  let waiter: ((b: Uint8Array | Error) => void) | null = null, gone = false;
  cp.addEventListener("characteristicvaluechanged", () => {
    const v = cp.value!; const b = new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    if (waiter) { const w = waiter; waiter = null; w(b); } else queue.push(b);
  });
  device.addEventListener("gattserverdisconnected", () => { gone = true; if (waiter) { const w = waiter; waiter = null; w(Error("The keyboard disconnected.")); } });
  await cp.startNotifications();
  const link: DfuLink = {
    control: (b) => (cp.writeValueWithResponse ? cp.writeValueWithResponse(b) : cp.writeValue(b)),
    packet: (b) => (pk.writeValueWithoutResponse ? pk.writeValueWithoutResponse(b) : pk.writeValue(b)),
    next: (ms) => new Promise<Uint8Array>((resolve, reject) => {
      if (queue.length) return resolve(queue.shift()!);
      if (gone) return reject(Error("The keyboard disconnected."));
      const timer = setTimeout(() => { waiter = null; reject(Error("The bootloader did not answer in time. Stopped; nothing was retried.")); }, ms);
      waiter = (b) => { clearTimeout(timer); b instanceof Error ? reject(b) : resolve(b); };
    }),
    version: async () => { if (!ver) return null; const v = await ver.readValue(); return v.byteLength >= 2 ? v.getUint16(0, true) : null; },
  };
  return {link, name: device.name ?? "", close: () => { try { device.gatt?.disconnect(); } catch { /* already gone */ } }};
}
