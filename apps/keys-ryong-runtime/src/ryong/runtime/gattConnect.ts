// Bluetooth (Web Bluetooth) connection to ZMK Studio, usable on Windows/macOS too.
//
// The stock client asks the browser for devices *advertising* the Studio service. ZMK advertises only
// the HID and battery services, so outside Linux (whose BlueZ remembers a paired device's services)
// the chooser stays empty. Here, on other systems, the chooser lists nearby devices and we check for
// the Studio service after the person picks one. Same stream behaviour as the stock transport.
import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
import { t } from "../i18n";

const SERVICE_UUID = "00000000-0196-6107-c967-c5cfb1c2482a";
const RPC_CHRC_UUID = "00000001-0196-6107-c967-c5cfb1c2482a";

/** Linux/Android (BlueZ) can match the Studio service directly; elsewhere we must list devices. */
export const matchesStudioDirectly = () => /Linux/.test(navigator.userAgent);

export async function connect(): Promise<RpcTransport> {
  const options: RequestDeviceOptions = matchesStudioDirectly()
    ? { filters: [{ services: [SERVICE_UUID] }], optionalServices: [SERVICE_UUID] }
    : { acceptAllDevices: true, optionalServices: [SERVICE_UUID] };
  const dev = await navigator.bluetooth.requestDevice(options).catch((e) => {
    if (e instanceof DOMException && e.name == "NotFoundError") throw new UserCancelledError("User cancelled the connection attempt", { cause: e });
    throw e;
  });
  if (!dev.gatt) throw new Error("No GATT server");
  const label = dev.name || "Unknown";
  if (!dev.gatt.connected) await dev.gatt.connect();
  let svc: BluetoothRemoteGATTService;
  try { svc = await dev.gatt.getPrimaryService(SERVICE_UUID); }
  catch {
    dev.gatt.disconnect();
    throw new Error(t(`${label} has no ZMK Studio connection. Pick the keyboard, and unlock it first (Esc + Backspace).`,
      `${label}에는 키보드 설정 연결이 없어요. 키보드를 고르고, 먼저 잠금을 푸세요 (Esc + Backspace).`));
  }
  const char = await svc.getCharacteristic(RPC_CHRC_UUID);
  const abortController = new AbortController();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Reconnecting to the same device loses notifications unless they are stopped first.
      await char.stopNotifications();
      await char.startNotifications();
      const vc = (ev: Event) => {
        const buf = (ev.target as BluetoothRemoteGATTCharacteristic | null)?.value?.buffer;
        if (buf) controller.enqueue(new Uint8Array(buf as ArrayBuffer));
      };
      char.addEventListener("characteristicvaluechanged", vc);
      const cb = () => {
        char.removeEventListener("characteristicvaluechanged", vc);
        dev.removeEventListener("gattserverdisconnected", cb);
        controller.close();
      };
      dev.addEventListener("gattserverdisconnected", cb);
    },
  });
  const writable = new WritableStream<Uint8Array>({ write: (chunk) => char.writeValueWithoutResponse(chunk) });
  const sig = abortController.signal;
  const abort = () => { sig.removeEventListener("abort", abort); dev.gatt?.disconnect(); };
  sig.addEventListener("abort", abort);
  return { label, abortController, readable, writable };
}
