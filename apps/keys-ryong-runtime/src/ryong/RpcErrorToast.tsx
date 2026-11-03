// Shows keyboard communication failures that the original Studio screens only logged (a failed
// keymap save looked like a success). Raised by rpc/logging.ts.
import { useEffect, useState } from "react";
import { t } from "./i18n";

const EVENT = "ryong-rpc-error";

export function reportRpcError(what: string, error: unknown) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { what, error: String((error as Error)?.message ?? error) } }));
}

export function RpcErrorToast() {
  const [msg, setMsg] = useState<{ what: string; error: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setMsg((e as CustomEvent).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  if (!msg) return null;
  return <div className="ry-toast" role="alert">
    <span>{t("The keyboard didn't do that: {what}. Check the connection and try again.", "키보드에 반영되지 않았어요: {what}. 연결을 확인하고 다시 해 주세요.", { what: msg.what })}
      <span className="ry-faint"> ({msg.error})</span></span>
    <button className="ry-text" onClick={() => setMsg(null)}>{t("Close", "닫기")}</button>
  </div>;
}
