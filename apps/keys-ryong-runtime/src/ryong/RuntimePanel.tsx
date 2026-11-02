import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BehaviorsEditor } from "./behaviors/BehaviorsEditor";
import { RyongMark } from "./RyongMark";
import { LangToggle } from "./LangToggle";
import { t } from "./i18n";

export function RuntimePanel({ open, onClose, deviceName }: { open: boolean; onClose: () => void; deviceName?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return <dialog ref={ref} className="ry-hub is-wide" onClose={onClose}
    onMouseDown={event => event.target === ref.current && onClose()} aria-label="Runtime development">
    <div className="ry-hub-top">
      <span className="ry-brand"><RyongMark /><strong>Keys</strong></span>
      <span className="ry-faint">{t("Runtime development", "동적 설정 개발본")}</span>
      <div className="ry-hub-top-end"><LangToggle />
        <button className="ry-icon" onClick={onClose} aria-label={t("Close", "닫기")}><X /></button>
      </div>
    </div>
    <div className="ry-hub-body"><div className="ry-hub-page">
      {open && <BehaviorsEditor connectedName={deviceName} />}
    </div></div>
  </dialog>;
}
