// Keyboard-side settings (lights, deep sleep) over the secured ryong__settings subsystem.
// Replaces the old "firmware features" that needed a rebuild. Never auto-retries a change.
import { call_rpc, RpcConnection } from "@zmkfirmware/zmk-studio-ts-client/index";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { callRuntimePayload, discoverRuntime } from "./customRpc";
import * as S from "./proto/settings";
import { t } from "../i18n";

export const SETTINGS_SUBSYSTEM = "ryong__settings";
const PROTOCOL = 1;
export type DeviceSettings = S.Settings;
export type DeviceState = S.State;
export const BACKLIGHT = 0, UNDERGLOW = 1;

const ERRORS: Record<number, () => string> = {
  1: () => t("This light is kept off by its rules (feature off, or USB-only on battery).", "설정 때문에 지금은 켤 수 없어요 (기능 꺼짐, 또는 배터리일 때 USB 전용)."),
  5: () => t("The keyboard could not save the change. Reload and check.", "키보드가 저장하지 못했어요. 다시 읽어서 확인하세요."),
  22: () => t("The keyboard rejected these values.", "키보드가 이 값을 받아들이지 않았어요."),
  95: () => t("This keyboard has no such light.", "이 키보드에는 해당 조명이 없어요."),
  134: () => t("This keyboard has no such light.", "이 키보드에는 해당 조명이 없어요."),
};
export class KeyboardError extends Error {}

/** Same limits as settings_core.c; throws a message for the person. */
export function validate(s: DeviceSettings) {
  const int = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!int(s.sleepMinutes, 1, 1440)) throw new KeyboardError(t("Sleep time must be 1–1440 minutes.", "절전 시간은 1–1440분이어야 해요."));
  for (const l of [s.backlight, s.underglow]) if (!l || !int(l.brightness, 0, 100)) throw new KeyboardError(t("Brightness must be 0–100%.", "밝기는 0–100%여야 해요."));
  return s;
}

function check(state: S.State | undefined): S.State {
  if (!state || state.protocolVersion !== PROTOCOL || !state.settings || !state.caps || !state.settings.backlight || !state.settings.underglow)
    throw new Error("Unsupported keyboard settings protocol.");
  validate(state.settings);
  return state;
}

export class DeviceSettingsClient {
  private busy = false;
  constructor(readonly conn: RpcConnection, readonly index: number, private readonly io = {
    unlocked: async () => {
      const r = await call_rpc(conn, { core: { getLockState: true } });
      if (r.core?.getLockState !== LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED)
        throw new Error(t("Unlock the keyboard first.", "먼저 키보드 잠금을 푸세요."));
    },
    payload: (bytes: Uint8Array) => callRuntimePayload(conn, index, bytes),
  }) {}

  private async rpc(request: S.Request) {
    await this.io.unlocked();
    const response = S.Response.decode(await this.io.payload(S.Request.encode(request).finish()));
    if (response.status) {
      const code = response.status.error;
      throw new KeyboardError(ERRORS[code]?.() ?? t(`Keyboard error ${code}.`, `키보드 오류 ${code}`));
    }
    return check(response.state);
  }

  read() { return this.rpc(S.Request.fromPartial({ getState: {} })); }

  private async once(request: S.Request, verify: (s: S.State) => boolean) {
    if (this.busy) throw new Error(t("Another change is in progress.", "다른 변경을 처리하는 중이에요."));
    this.busy = true;
    try {
      let state: S.State;
      try { state = await this.rpc(request); }
      catch (e) {
        if (e instanceof KeyboardError) throw e;
        throw new Error(`${e instanceof Error ? e.message : String(e)} ` + t("The result is unknown. Reload to check; nothing is retried.", "결과를 알 수 없어요. 다시 읽어서 확인하세요. 자동으로 다시 시도하지 않아요."));
      }
      if (!verify(state)) throw new Error(t("The keyboard reply does not match. Reload to check.", "키보드 응답이 요청과 달라요. 다시 읽어서 확인하세요."));
      return state;
    } finally { this.busy = false; }
  }

  save(next: DeviceSettings) {
    validate(next);
    return this.once(S.Request.fromPartial({ set: next }), (s) => JSON.stringify(s.settings) === JSON.stringify(S.Settings.fromPartial(next)));
  }

  power(which: number, on: boolean) {
    return this.once(S.Request.fromPartial({ power: { which, on } }), (s) => (which === BACKLIGHT ? s.backlightOn : s.underglowOn) === on);
  }
}

/** null when the firmware has no keyboard-side settings (older builds). */
export async function connectDeviceSettings(conn: RpcConnection) {
  const entry = (await discoverRuntime(conn)).find((s) => s.identifier === SETTINGS_SUBSYSTEM);
  return entry ? new DeviceSettingsClient(conn, entry.index) : null;
}
