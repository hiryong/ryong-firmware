import { Suspense, lazy, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { RyongMark } from "../RyongMark";
import { t } from "../i18n";
import { LangToggle } from "../LangToggle";

// Rarely needed things (for now the assembled board in 3D) live behind the footer, out of the
// everyday header. three.js only loads when this page opens.
const Board3D = lazy(() => import("./Board3D"));

export const Maintenance = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="ry-hub ry-maint" onClose={onClose} aria-label={t("Maintenance", "유지보수")}>
      <div className="ry-hub-top">
        <button className="ry-brand" onClick={onClose} aria-label={t("Back to the editor", "편집 화면으로")}>
          <RyongMark />
          <strong>Keys</strong>
        </button>
        <div className="ry-maint-title">
          <strong>{t("Maintenance", "유지보수")}</strong>
          <span className="ry-faint">{t("Board in 3D · ryong60", "기판 3D · ryong60")}</span>
        </div>
        <div className="ry-hub-top-end">
          <LangToggle />
          <button className="ry-icon" onClick={onClose} aria-label={t("Close", "닫기")}><X /></button>
        </div>
      </div>
      {open && (
        <Suspense fallback={<p className="ry-b3-msg">{t("Loading…", "불러오는 중…")}</p>}>
          <Board3D />
        </Suspense>
      )}
    </dialog>
  );
};
