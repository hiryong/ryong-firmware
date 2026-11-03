import { RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { call_rpc } from "../../rpc/pipeline";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { callRuntimePayload, discoverRuntime } from "./customRpc";
import * as B from "./proto/ble_profiles";
import { t } from "../i18n";

export const BLE_PROFILES_SUBSYSTEM = "ryong__ble_profiles";
const PROTOCOL = 1;
const encoder = new TextEncoder();

/** Mirrors firmware validation (profile_core.c). Returns the exact bytes-safe name or throws. */
export function normalizeName(raw: string, maxBytes = 30) {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (encoder.encode(name).length > maxBytes) throw new Error("NAME_TOO_LONG");
  // C0/C1 controls, line/paragraph separators and bidi overrides are refused by firmware too.
  if (/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/.test(name)) throw new Error("NAME_INVALID");
  return name;
}

const ERRORS: Record<number, () => string> = {
  2: () => t("This slot has no registered device.", "이 슬롯에는 등록된 기기가 없습니다."),
  5: () => t("The keyboard could not save the change. Reload and check before trying again.", "키보드가 변경을 저장하지 못했습니다. 다시 읽어서 확인한 뒤 시도하세요."),
  22: () => t("The keyboard rejected the request.", "키보드가 요청을 거부했습니다."),
  116: () => t("This slot changed (re-paired or cleared). Reload before trying again.", "이 슬롯이 그사이 바뀌었습니다(다시 페어링 또는 삭제). 다시 읽은 뒤 시도하세요."),
};

/** A definite refusal from firmware, as opposed to a lost/unknown reply. */
export class KeyboardError extends Error {}

async function unlocked(conn: RpcConnection) {
  const response = await call_rpc(conn, { core: { getLockState: true } });
  if (response.core?.getLockState !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED)
    throw new Error(t("Unlock Studio before managing Bluetooth devices.", "Bluetooth 기기를 관리하려면 먼저 잠금을 푸세요."));
}

export class BleProfileDevice {
  private busy = false;
  constructor(readonly conn: RpcConnection, readonly index: number, private readonly io = {
    unlocked: () => unlocked(conn),
    payload: (bytes: Uint8Array) => callRuntimePayload(conn, index, bytes),
  }) {}

  private async rpc(request: B.Request) {
    await this.io.unlocked();
    const response = B.Response.decode(await this.io.payload(B.Request.encode(request).finish()));
    if (response.status) {
      const code = response.status.error;
      throw new KeyboardError(ERRORS[code]?.() ?? t(`Keyboard error ${code}.`, `키보드 오류 ${code}`));
    }
    return check(response.state);
  }

  read() { return this.rpc(B.Request.fromPartial({ getState: {} })); }

  /** Each change: confirm the slot still matches what the user saw, send once, read back. Never auto-retries. */
  private async change(index: number, before: B.State, request: B.Request, verify: (s: B.State) => boolean) {
    if (this.busy) throw new Error(t("Another Bluetooth change is in progress.", "다른 Bluetooth 변경을 처리하는 중입니다."));
    this.busy = true;
    try {
      const seen = before.profiles.find(p => p.index === index);
      const now = (await this.read()).profiles.find(p => p.index === index);
      if (!seen || !now || seen.bonded !== now.bonded || seen.token !== now.token)
        throw new KeyboardError(ERRORS[116]());
      let state: B.State;
      try { state = await this.rpc(request); }
      catch (e) {
        if (e instanceof KeyboardError) throw e; // definite answer from the keyboard
        throw new Error(`${e instanceof Error ? e.message : String(e)} ` + t("The result is unknown. Reload to inspect; nothing is retried automatically.", "결과를 알 수 없습니다. 다시 읽어서 확인하세요. 자동으로 다시 시도하지 않습니다."));
      }
      if (!verify(state)) throw new Error(t("The keyboard reply does not match the request. Reload to inspect.", "키보드 응답이 요청과 다릅니다. 다시 읽어서 확인하세요."));
      return state;
    } finally { this.busy = false; }
  }

  select(index: number, before: B.State) {
    return this.change(index, before, B.Request.fromPartial({ select: { index } }), s => s.activeIndex === index);
  }

  rename(index: number, raw: string, before: B.State) {
    const name = normalizeName(raw, before.nameMaxBytes);
    const token = before.profiles.find(p => p.index === index)?.token ?? 0;
    if (!token) return Promise.reject(new KeyboardError(ERRORS[2]()));
    return this.change(index, before, B.Request.fromPartial({ rename: { index, token, name } }),
      s => s.profiles.find(p => p.index === index)?.name === name);
  }

  /** Keyboard-side only. The host keeps its own pairing entry. */
  clear(index: number, before: B.State) {
    const token = before.profiles.find(p => p.index === index)?.token ?? 0;
    if (!token) return Promise.reject(new KeyboardError(ERRORS[2]()));
    return this.change(index, before, B.Request.fromPartial({ clear: { index, token } }), s => {
      const p = s.profiles.find(p => p.index === index);
      return !!p && !p.bonded && !p.name;
    });
  }
}

function check(state: B.State | undefined): B.State {
  if (!state || state.protocolVersion !== PROTOCOL) throw new Error("Unsupported Bluetooth manager protocol.");
  const ids = new Set(state.profiles.map(p => p.index));
  if (state.profiles.length < 1 || state.profiles.length > 8 || ids.size !== state.profiles.length ||
      state.profiles.some(p => !Number.isInteger(p.index) || p.index < 0 || p.index > 7 ||
        encoder.encode(p.name).length > state.nameMaxBytes || (!p.bonded && (p.name || p.token || p.connected))) ||
      !ids.has(state.activeIndex) || state.nameMaxBytes < 1 || state.nameMaxBytes > 64)
    throw new Error("Invalid Bluetooth profile response.");
  return { ...state, profiles: [...state.profiles].sort((a, b) => a.index - b.index) };
}

/** null when the firmware does not provide the manager (UI then hides those controls). */
export async function connectBleProfiles(conn: RpcConnection) {
  const entry = (await discoverRuntime(conn)).find(s => s.identifier === BLE_PROFILES_SUBSYSTEM);
  return entry ? new BleProfileDevice(conn, entry.index) : null;
}
