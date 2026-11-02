import { ReactNode, useContext, useEffect, useState } from "react";
import { BehaviorsEditor, RuntimeSection } from "./behaviors/BehaviorsEditor";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LAYOUTS } from "./behaviors/layouts";
import { RuntimeBindingsContext } from "./runtime/bindings";
import type { RuntimeView } from "./runtime/modelBridge";
import { HostPanel } from "./HostPanel";
import { t } from "./i18n";

type Section = "keymap" | "host" | RuntimeSection;

/** One workspace and connection. Switching sections never unmounts either editor. */
export function RuntimePanel({ open, onClose, deviceName, onSaved, keymap, onSectionChange }: {
  open: boolean; onClose: () => void; deviceName?: string; onSaved?: () => void;
  keymap: ReactNode; onSectionChange?: (section: Section) => void;
}) {
  const { conn } = useContext(ConnectionContext);
  const [section, setSection] = useState<Section>("keymap");
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<RuntimeView | null>(null);
  useEffect(() => onSectionChange?.(section), [section, onSectionChange]);
  if (!open) return <main className="ry-workspace" />;
  const tabs: { id: Section; label: string }[] = [
    { id: "keymap", label: t("Keymap", "키맵") },
    { id: "combos", label: t("Combos", "콤보") },
    { id: "macros", label: t("Macros", "매크로") },
    { id: "tapDances", label: t("Tap Dance", "탭댄스") },
    { id: "settings", label: "Hold-Tap" },
    { id: "host", label: t("Bluetooth", "Bluetooth 기기") },
  ];
  return <main className="ry-workspace" aria-label={t("Keyboard settings", "키보드 설정")}>
    <div className="ry-workspace-top">
      <div><strong>{deviceName || t("Keyboard preview", "키보드 미리보기")}</strong>
        <span className="ry-faint">{conn ? t(" · One connection · no rebuild", " · 연결됨 · 재빌드 없이 설정")
          : t(" · Preview only · no device changes", " · 미리보기 · 실제 기기는 변경하지 않음")}</span></div>
      {!conn && import.meta.env.VITE_RYONG_PREVIEW_ONLY !== "1" && <button className="ry-text" onClick={() => {
        if (!dirty || confirm(t("Discard unsaved preview edits and connect?", "저장하지 않은 미리보기 변경을 버리고 연결할까요?"))) onClose();
      }}>{t("Connect keyboard", "키보드 연결")}</button>}
    </div>
    <nav className="ry-tabs ry-workspace-tabs" aria-label={t("Keyboard settings sections", "키보드 설정 메뉴")}>
      {tabs.map(tab => <button key={tab.id} className="ry-tab" aria-pressed={section === tab.id}
        aria-controls={tab.id === "keymap" ? "ry-keymap-pane" : tab.id === "host" ? "ry-host-pane" : "ry-dynamic-pane"}
        onClick={() => setSection(tab.id)}>{tab.label}{dirty && tab.id !== "keymap" && tab.id !== "host" && <span aria-label={t("Unsaved changes", "저장 안 된 변경")}> ·</span>}</button>)}
    </nav>
    <RuntimeBindingsContext.Provider value={view}>
    <section id="ry-keymap-pane" className="ry-workspace-keymap" hidden={section !== "keymap"}>
      {conn ? keymap : <div className="ry-workspace-preview">
        <svg viewBox="0 0 1500 500" role="img" aria-label={t("60 percent keyboard layout preview", "60% 키보드 배열 미리보기")}>
          {LAYOUTS["60-ansi"].map(([x,y,w,h,label],i) => <g key={i}>
            <rect x={x+4} y={y+4} width={w-8} height={h-8} rx="8" />
            <text x={x+w/2} y={y+h/2+6} textAnchor="middle">{label}</text>
          </g>)}
        </svg>
        <p className="ry-note">{t("Connect and unlock your keyboard to edit its real keymap. Explore dynamic settings in the same menu.", "연결하고 잠금을 풀면 실제 키맵을 편집할 수 있습니다. 같은 메뉴에서 동적 설정을 미리 볼 수 있습니다.")}</p>
      </div>}
    </section>
    <section id="ry-dynamic-pane" className="ry-workspace-dynamic" hidden={section === "keymap" || section === "host"}>
      <BehaviorsEditor connectedName={deviceName} onRuntimeSaved={onSaved} embedded
        activeSection={section === "keymap" || section === "host" ? "combos" : section} onDirty={setDirty} onView={setView} />
    </section>
    <section id="ry-host-pane" className="ry-workspace-dynamic" hidden={section !== "host"}><HostPanel /></section>
    </RuntimeBindingsContext.Provider>
  </main>;
}
