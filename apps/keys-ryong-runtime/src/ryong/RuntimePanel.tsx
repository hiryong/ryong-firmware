import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { BehaviorsEditor } from "./behaviors/BehaviorsEditor";
import { RyongMark } from "./RyongMark";
import { LangToggle } from "./LangToggle";
import { t } from "./i18n";

export function RuntimePanel({ open, onClose, deviceName, onSaved }: { open: boolean; onClose: () => void; deviceName?: string; onSaved?: () => void }) {
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
      {open && <BehaviorsEditor connectedName={deviceName} onRuntimeSaved={onSaved} />}
      <details className="ry-card" style={{marginTop:24}}>
        <summary>{t("Settings save and firmware updates", "설정 저장과 펌웨어 업데이트")}</summary>
        <p className="ry-note">{t("Daily keymap and dynamic settings changes use Save, without a firmware rebuild. New features and fixes require a firmware update.", "평소 키맵과 동적 설정 변경은 저장 버튼을 사용합니다. 펌웨어를 다시 빌드하지 않습니다. 새 기능 추가나 오류 수정 때 펌웨어를 업데이트합니다.")}</p>
        <p className="ry-note">{t("Keep both the existing keymap backup and the dynamic settings backup. Importing dynamic settings changes only the editor until you press Save.", "기존 키맵 백업과 동적 설정 백업을 모두 보관하세요. 동적 설정 백업을 불러와도 저장을 누르기 전에는 장치에 적용하지 않습니다.")}</p>
        <p className="ry-note">{t("Development firmware is not available for installation yet. BT60 identity, settings migration and a working recovery path must be verified first. The standalone HTML preview does not connect to a keyboard.", "개발 펌웨어는 아직 설치용으로 제공하지 않습니다. BT60 식별·설정 이전·복구 방법을 먼저 검증해야 합니다. 별도 HTML 미리보기는 키보드와 연결하지 않습니다.")}</p>
      </details>
    </div></div>
  </dialog>;
}

