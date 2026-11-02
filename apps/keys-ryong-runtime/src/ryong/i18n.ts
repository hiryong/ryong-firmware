// English by default, Korean on request. The choice is kept in this browser.
//
// - ryong code: t("English", "한국어") for plain strings, L(<>English</>, <>한국어</>) for sentences with markup.
//   Both languages sit side by side in the code, so there is no dictionary to keep in step.
// - official ZMK Studio screens (header menu, connect and unlock dialogs, layer list…): their files stay
//   untouched so updates merge cleanly; their fixed English texts are swapped on the page instead (UPSTREAM).
//   Anything that is keyboard data (key labels, layer names, behavior names from the firmware) is left alone.

import { ReactNode, useSyncExternalStore } from "react";

export type Lang = "en" | "ko";
const KEY = "ryong.lang";

let lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === "ko" ? "ko" : "en";
  } catch {
    return "en";
  }
})();
const listeners = new Set<() => void>();

export const getLang = () => lang;
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* no storage */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
  translateUpstream();
}

/** Re-render when the language changes. App calls this, so everything below it follows. */
export const useLang = () =>
  useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => lang
  );

/** t("{n} keys", "키 {n}개", { n: 3 }) */
export function t(en: string, ko: string, vars?: Record<string, string | number>) {
  let s = lang === "ko" ? ko : en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export const L = (en: ReactNode, ko: ReactNode): ReactNode => (lang === "ko" ? ko : en);

// ---------- official Studio texts ----------
// Exact text of a text node (trimmed) → Korean. A value starting with "~" also drops the node's leading space
// (for a sentence that continues after a link).

const UPSTREAM: Record<string, string> = {
  "Connect a keyboard": "키보드 연결",
  "Select a connection type.": "연결 방식을 고르세요.",
  "Select A Device:": "기기를 고르세요:",
  "Unlock To Continue": "잠금을 풀어주세요",
  "For security reasons, your keyboard requires unlocking before using ZMK Studio.":
    "보안을 위해 편집 전에 키보드에서 잠금을 풀어야 해요.",
  "If studio unlocking hasn't been added to your keymap or a combo, see the": "키맵이나 콤보에 잠금 해제 키가 없다면",
  "Studio Unlock Behavior": "Studio Unlock 문서",
  "documentation for more infomation.": "~를 참고하세요.",
  Disconnect: "연결 끊기",
  "Restore Stock Settings": "기본 설정으로 되돌리기",
  "Settings reset will remove any customizations previously made in ZMK Studio and restore the stock keymap":
    "편집기에서 바꾼 내용을 모두 지우고 펌웨어의 기본 키맵으로 되돌려요.",
  "Continue?": "계속할까요?",
  Cancel: "취소",
  Undo: "실행 취소",
  Redo: "다시 실행",
  Save: "저장",
  Discard: "변경 취소",
  Layers: "레이어",
  Layout: "배열",
  "Behavior:": "동작:",
  "New Layer Name": "새 레이어 이름",
  Auto: "자동",
  "Built on": "기반:",
  "by the ZMK Contributors": "· ZMK Contributors",
  "About ZMK Studio": "ZMK Studio 정보",
};

// Keyboard data and our own components are never touched.
const SKIP = ".ry-key, [role='option'], input, textarea, select, [data-ry-i18n-skip], .ry-hub, .ry-unlock, .ry-offer, .ry-tabs";
// what a node said before we changed it, and what we wrote (if React later writes something else, that's the new original)
const seen = new WeakMap<Text, { orig: string; wrote: string }>();
let observer: MutationObserver | null = null;

function translateNode(n: Text) {
  const parent = n.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  let rec = seen.get(n);
  if (rec && n.data !== rec.wrote) rec = undefined;
  const src = rec ? rec.orig : n.data;
  const ko = UPSTREAM[src.trim()];
  if (!ko) return;
  if (lang === "en") {
    if (rec && n.data !== rec.orig) n.data = rec.orig;
    seen.delete(n);
    return;
  }
  const lead = ko.startsWith("~") ? "" : src.match(/^\s*/)![0];
  const next = lead + ko.replace(/^~/, "") + src.match(/\s*$/)![0];
  seen.set(n, { orig: src, wrote: next });
  if (n.data !== next) n.data = next;
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateNode(root as Text);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) translateNode(n as Text);
}

export function translateUpstream() {
  if (typeof document === "undefined") return;
  walk(document.body);
  if (observer) return;
  observer = new MutationObserver((ms) => {
    if (lang === "en") return;
    for (const m of ms) {
      if (m.type === "characterData") translateNode(m.target as Text);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
}

export function setupLang() {
  document.documentElement.lang = lang;
  if (lang === "ko") translateUpstream();
}
