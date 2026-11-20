// While a keyboard connects, say so: after the browser's list closes the connect screen used to
// stay as it was for seconds (opening the keyboard, its first answer), which looked like a dead site.
// Each step's time is written to the console too ("[connect] …") to find what takes long.
import { useEffect, useState } from "react";
import { t } from "./i18n";

export type ConnectPhase = "idle" | "opening" | "asking" | "reading";
const EVENT = "ryong:connect-phase";
let since = 0, last = 0, current: ConnectPhase = "idle";

export function connectPhase(phase: ConnectPhase) {
  const now = performance.now();
  if (current !== "idle") console.info(`[connect] ${current} ${Math.round(now - last)} ms`);
  if (phase === "idle" && current !== "idle") console.info(`[connect] total ${Math.round(now - since)} ms`);
  if (current === "idle" && phase !== "idle") since = now;
  last = now; current = phase;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: phase }));
}

/** A connection is being set up (from the browser's list closing until the keyboard's first answer). */
export const connectBusy = () => current !== "idle";

export function ConnectProgress() {
  const [phase, setPhase] = useState<ConnectPhase>(current);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = (e: Event) => setPhase((e as CustomEvent<ConnectPhase>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (phase === "idle") return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [phase]);
  if (phase === "idle") return null;
  const secs = Math.floor((performance.now() - since) / 1000);
  const text = {
    opening: t("Opening the keyboard…", "키보드를 여는 중…"),
    asking: t("Waiting for the keyboard's first answer…", "키보드의 첫 응답을 기다리는 중…"),
    reading: t("Reading the keyboard…", "키보드를 읽는 중…"),
  }[phase];
  return <div className="ry-connecting" role="status" aria-live="polite">
    <span className="ry-connecting-dot" />{text}{secs >= 2 && <span className="ry-faint"> {t("{n} s", "{n}초", { n: secs })}</span>}
    {phase === "asking" && secs >= 3 && <div className="ry-faint">{t("A keyboard asleep wakes with a key press.", "키보드가 잠들어 있으면 키를 한 번 눌러 깨워 주세요.")}</div>}
  </div>;
}
