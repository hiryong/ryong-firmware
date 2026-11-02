import { RyongMark } from "./RyongMark";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { markSignInFailed, takeReturn } from "./api";
import { Firmware } from "./Firmware";
import { Backup } from "./BackupPage";
import { Guide } from "./Guide";
import { t } from "./i18n";
import { LangToggle } from "./LangToggle";

// Everything beyond the key editor lives in one side panel. Nothing here asks anyone to sign in
// until they use something that needs GitHub.
export type HubTab = "firmware" | "backup" | "guide";

/** keysbeta (runtime build) has no Firmware tab: builds and releases live in /admin. */
export const FIRMWARE_TAB = import.meta.env.VITE_RYONG_RUNTIME !== "1";
export const HUB_TABS: { id: HubTab; label: () => string }[] = [
  ...(FIRMWARE_TAB ? [{ id: "firmware" as HubTab, label: () => t("Firmware", "펌웨어") }] : []),
  { id: "backup", label: () => t("Backup", "백업") },
  { id: "guide", label: () => t("Guide", "가이드") },
];

/** After coming back from GitHub, reopen the tab the person was on. */
export function useResumeHub(setTab: (t: HubTab) => void) {
  useEffect(() => {
    const { tab, failed } = takeReturn();
    if (failed) markSignInFailed();
    if (tab && HUB_TABS.some((x) => x.id === tab)) setTab(tab as HubTab);
  }, []);
}

export interface HubProps {
  tab: HubTab | null;
  onTab: (t: HubTab) => void;
  onClose: () => void;
  deviceName?: string;
  /** reload the editor after a restore */
  onRestored: () => void;
}

export const Hub = ({ tab, onTab, onClose, deviceName, onRestored }: HubProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  // A keyboard opened for editing needs the wide panel.
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (tab && !d.open) d.showModal();
    if (!tab && d.open) d.close();
  }, [tab]);

  return (
    <dialog
      ref={ref}
      className={`ry-hub ${tab === "firmware" && wide ? "is-wide" : ""}`}
      onClose={onClose}
      onMouseDown={(e) => e.target === ref.current && onClose()}
      aria-label="keys.ryong.com"
    >
      <div className="ry-hub-top">
        {/* the brand here takes you back to the editor */}
        <button className="ry-brand" onClick={onClose} aria-label={t("Back to the editor", "편집 화면으로")}>
          <RyongMark />
          <strong>Keys</strong>
        </button>
        <div className="ry-tabs" role="tablist">
          {HUB_TABS.map((tb) => (
            <button key={tb.id} className="ry-tab" data-tab={tb.id} aria-pressed={tab === tb.id} ref={(el) => { if (el) el.toggleAttribute("autofocus", tab === tb.id); }} onClick={() => onTab(tb.id)}>
              {tb.label()}
            </button>
          ))}
        </div>
        <div className="ry-hub-top-end">
          <LangToggle />
          <button className="ry-icon" onClick={onClose} aria-label={t("Close", "닫기")}>
            <X />
          </button>
        </div>
      </div>
      <div className="ry-hub-body">
        <div className="ry-hub-page">
        {tab === "firmware" && FIRMWARE_TAB && <Firmware deviceName={deviceName} onWide={setWide} />}
        {tab === "backup" && <Backup deviceName={deviceName} onRestored={onRestored} />}
        {tab === "guide" && <Guide onTab={onTab} />}
        </div>
      </div>
    </dialog>
  );
};
