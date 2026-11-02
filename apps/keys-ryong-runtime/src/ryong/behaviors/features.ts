// Firmware features that are just on or off (ZMK's CONFIG_… y/n options), kept in the keyboard's
// config/<board>.conf. A line in that file wins; without one the board's default applies — boards set up
// for this site list theirs in ryong-power.json ("defaults"), otherwise ZMK's own default is assumed.

import { t } from "../i18n";

export interface Feature {
  name: string;
  label: () => string;
  hint?: () => string;
  /** ZMK's default when the board says nothing */
  def: boolean | number;
  /** needs this hardware on the board ("underglow", "backlight") */
  hw?: string;
  /** only meaningful when this other feature is on */
  needs?: string;
  /** a number rather than on/off (then `def` is ZMK's default number) */
  range?: { min: number; max: number; unit: string };
  /**
   * Switches that move with this one: `follow` ones turn on and off with it (underglow and the LED power
   * switch, ZMK_EXT_POWER); `need` ones only have to be on while it is.
   */
  linked?: { follow?: string[]; need?: string[] };
}

export const FEATURES: Feature[] = [
  // Names, defaults and ranges as in ZMK's lighting configuration (zmk.dev/docs/config/lighting).
  { name: "ZMK_BACKLIGHT", hw: "backlight", def: false, label: () => t("Backlight", "백라이트"), hint: () => t("Key lights. Needed for brightness keys.", "키 아래 조명이에요. 밝기 키를 쓰려면 켜야 해요.") },
  { name: "ZMK_BACKLIGHT_ON_START", needs: "ZMK_BACKLIGHT", def: true, label: () => t("On when the keyboard starts", "켤 때 백라이트 켜기") },
  { name: "ZMK_BACKLIGHT_AUTO_OFF_USB", needs: "ZMK_BACKLIGHT", def: false, label: () => t("Off when USB is unplugged", "USB를 빼면 끄기"), hint: () => t("Lit only on a cable, so it doesn't drain the battery.", "케이블을 꽂았을 때만 켜져서 배터리를 쓰지 않아요.") },
  { name: "ZMK_BACKLIGHT_BRT_START", needs: "ZMK_BACKLIGHT", def: 40, range: { min: 0, max: 100, unit: "%" }, label: () => t("Brightness at start", "시작 밝기"), hint: () => t("ZMK has no maximum for the backlight; this is where it starts.", "백라이트는 ZMK에 최대 밝기 설정이 없어서, 켤 때의 밝기를 정해요.") },
  { name: "ZMK_RGB_UNDERGLOW", hw: "underglow", def: false, linked: { follow: ["ZMK_EXT_POWER"], need: ["ZMK_RGB_UNDERGLOW_EXT_POWER"] }, label: () => t("RGB underglow", "RGB 언더글로우"), hint: () => t("Lights under the board. Its LED power switch (EXT_POWER) turns on and off with it, so off means no power at all.", "기판 아래 조명이에요. LED 전원 스위치(EXT_POWER)가 함께 켜지고 꺼져서, 끄면 전력도 쓰지 않아요.") },
  { name: "ZMK_RGB_UNDERGLOW_ON_START", needs: "ZMK_RGB_UNDERGLOW", def: true, label: () => t("On when the keyboard starts", "켤 때 언더글로우 켜기") },
  { name: "ZMK_RGB_UNDERGLOW_AUTO_OFF_USB", needs: "ZMK_RGB_UNDERGLOW", def: false, label: () => t("Off when USB is unplugged", "USB를 빼면 끄기"), hint: () => t("Lit only on a cable. On battery the LEDs drain it within days, even dark.", "케이블을 꽂았을 때만 켜져요. 배터리로 켜 두면 꺼진 상태로도 며칠 만에 배터리가 닳아요.") },
  { name: "ZMK_RGB_UNDERGLOW_BRT_MAX", needs: "ZMK_RGB_UNDERGLOW", def: 100, range: { min: 0, max: 100, unit: "%" }, label: () => t("Maximum brightness", "최대 밝기"), hint: () => t("About 50% is plenty under a board, and keeps USB power in check.", "기판 아래 조명은 50% 정도면 충분하고, USB 전력도 여유가 생겨요.") },
  { name: "ZMK_SLEEP", def: false, label: () => t("Deep sleep when idle", "안 쓰면 깊은 절전"), hint: () => t("Saves battery. Any key wakes it.", "배터리를 아껴요. 아무 키나 누르면 다시 켜져요.") },
  { name: "ZMK_PM_SOFT_OFF", def: false, label: () => t("Soft Off (a key that turns the keyboard off)", "Soft Off (키로 전원 끄기)") },
  { name: "ZMK_POINTING", def: false, label: () => t("Mouse keys", "마우스 키"), hint: () => t("Pointer, click and scroll from the keyboard.", "키보드로 마우스 포인터를 움직이고, 클릭과 스크롤을 해요.") },
  { name: "ZMK_HID_REPORT_TYPE_NKRO", def: false, label: () => t("N-key rollover", "N키 롤오버"), hint: () => t("Any number of keys at once. Some BIOS/KVMs don't support it.", "여러 키를 동시에 눌러도 모두 입력돼요. 일부 BIOS나 KVM에서는 안 될 수 있어요.") },
  { name: "BT_CTLR_TX_PWR_PLUS_8", def: false, label: () => t("Stronger Bluetooth signal", "블루투스 신호 강하게"), hint: () => t("Better range, a little more battery.", "신호가 더 멀리 닿지만 배터리를 조금 더 써요.") },
  { name: "ZMK_STUDIO_LOCKING", def: true, label: () => t("Ask to unlock before editing", "편집 전에 잠금 해제 요구"), hint: () => t("Only someone at the keyboard can change keys.", "키보드 앞에 있는 사람만 키를 바꿀 수 있어요.") },
];

export const SLEEP_TIMEOUT = "ZMK_IDLE_SLEEP_TIMEOUT";

/** CONFIG_X=value lines → { X: value } */
export function parseConf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/^[ \t]*CONFIG_([A-Z0-9_]+)[ \t]*=[ \t]*(.*?)[ \t]*$/gm)) out[m[1]] = m[2];
  return out;
}

/** Apply edits (null = remove the line, back to the board default). */
export function applyConf(text: string, edits: Record<string, string | null>): string {
  let out = text;
  const added: string[] = [];
  for (const [name, v] of Object.entries(edits)) {
    const re = new RegExp(`^[ \\t]*CONFIG_${name}[ \\t]*=.*(?:\\n|$)`, "m");
    if (v === null) out = out.replace(re, "");
    else if (re.test(out)) out = out.replace(new RegExp(`^[ \\t]*CONFIG_${name}[ \\t]*=.*$`, "m"), `CONFIG_${name}=${v}`);
    else added.push(`CONFIG_${name}=${v}`);
  }
  if (added.length) out = `${out.trimEnd() ? out.trimEnd() + "\n\n" : ""}# Set on keys.ryong.com (Firmware → Edit → Settings)\n${added.join("\n")}\n`;
  return out;
}

export const isOn = (v: string | undefined) => v === "y";
