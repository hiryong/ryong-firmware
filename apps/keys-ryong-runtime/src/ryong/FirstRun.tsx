import { ChevronRight } from "lucide-react";
import { inApp } from "./app";
import { ConnectAnim } from "./Scenes";
import { t } from "./i18n";
import { LangToggle } from "./LangToggle";
import type { HubTab } from "./Hub";

/** Under "Connect a keyboard": what this dialog is for. */
export const ConnectLead = () => (
  <>
    <p className="ry-connect-lead">
      {t("Connect your keyboard to change its keys.", "키보드를 연결하면 바로 키를 바꿀 수 있어요.")}
      <br />
      {t("Changes apply right away; press Save to keep them.", "바꾼 키는 바로 적용되고, 저장을 눌러야 유지돼요.")}
    </p>
    <ConnectAnim />
    {/* Windows does not hand a Bluetooth LE keyboard's name to the browser (HidD_GetProductString is
        not supported for BLE HID), so Chrome lists it by its USB IDs. 1D50:615E is ZMK's. */}
    {/Windows/.test(navigator.userAgent) && <p className="ry-faint ry-connect-win">
      {t("Windows over Bluetooth: the first time, the browser's list shows the keyboard as “Unknown device (1D50:615E)” (Windows doesn't pass Bluetooth keyboard names to browsers). Pick it once; after that this site lists it by its own name.",
        "Windows에서 Bluetooth로 처음 연결할 때는 브라우저 목록에 키보드가 '알 수 없는 기기(1D50:615E)'로 보여요 (Windows가 Bluetooth 키보드 이름을 브라우저에 알려 주지 않아서예요). 한 번 고르면 다음부터는 이 사이트가 키보드 이름으로 보여 줘요.")}</p>}
  </>
);

/** Bottom of the dialog: the way to Firmware, kept small — most people never need it. */
export const FirstRun = ({ onTab, onApp }: { onTab: (t: HubTab) => void; onApp: () => void }) => (
  <div className="ry-connect-foot">
    {import.meta.env.VITE_RYONG_RUNTIME !== "1" && <button className="ry-advanced" onClick={() => onTab("firmware")}>
      <span>
        <span className="ry-advanced-t">{t("Firmware (advanced settings)", "펌웨어 (고급 설정)")}</span>
        <span className="ry-advanced-p">
          {t("Install or update firmware; combos, macros, lighting, power", "펌웨어 설치·업데이트, 콤보·매크로·조명·전원")}
        </span>
      </span>
      <ChevronRight aria-hidden="true" />
    </button>}
    <div className="ry-row">
      <div className="ry-gap">
        <button className="ry-text" onClick={() => onTab("guide")}>{t("Guide", "가이드")}</button>
        {!inApp && <button className="ry-text" onClick={onApp}>{t("Desktop app (Bluetooth)", "데스크톱 앱 (블루투스)")}</button>}
      </div>
      <LangToggle />
    </div>
  </div>
);
