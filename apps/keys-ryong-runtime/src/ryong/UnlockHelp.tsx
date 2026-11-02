import { useMemo } from "react";
import { useMe } from "./api";
import { matchesDevice, useCatalog, useMyBoards } from "./keyboards";
import { useBoardKeys } from "./boardKeys";
import { inApp } from "./app";
import type { HubTab } from "./Hub";
import { L, t } from "./i18n";
import { UnlockAnim } from "./UnlockAnim";

// The dialog focuses the first [autofocus] element when it opens; without one it would ring the first link.
const firstFocus = (el: HTMLElement | null) => el?.setAttribute("autofocus", "");

// what keyboards set up on this site start with: Esc + Backspace (top row, both ends of a 60%)
const DEFAULT_COMBO = [
  { label: "Esc", x: 0, y: 0, w: 100 },
  { label: "Backspace", x: 1300, y: 0, w: 200 },
];

/** Shown on the unlock screen: which keys unlock this keyboard, and the help that doesn't need unlocking. */
export const UnlockHelp = ({ deviceName, onTab, onApp }: { deviceName?: string; onTab: (t: HubTab) => void; onApp: () => void }) => {
  const me = useMe();
  const [catalog] = useCatalog();
  const mine = useMyBoards(me);
  const board = useMemo(() => [...mine.boards, ...(catalog || [])].find((b) => matchesDevice(b, deviceName)), [mine.boards, catalog, deviceName]);
  // locked: the keyboard can't tell yet, so this comes from its firmware files
  const { keys } = useBoardKeys(board, false);
  const loading = !catalog || me.loading || mine.loading || (!!board && !keys);
  const combo = keys?.unlockCombo;
  const key = keys?.unlock;

  return (
    <div className="ry-unlock">
      {board && (combo || key) ? (
        <>
          <div className="ry-unlock-keys" tabIndex={-1} ref={firstFocus} aria-label={t("Unlock with {k}", "잠금 해제: {k}", { k: (combo ?? key)!.join(" + ") })}>
            <UnlockAnim
              keys={(combo ? keys?.unlockComboKeys : keys?.unlockKeys) ?? (combo ?? key)!.map((label, i) => ({ label, x: i * 300, y: 0, w: 100 }))}
              mode={combo ? "together" : key!.length > 1 ? "hold" : "single"}
            />
          </div>
          <p className="ry-unlock-note">
            {combo ? t("Press them at the same time.", "동시에 누르세요.") : key!.length > 2 ? t("Hold {a}, then press {b} together.", "{a} 키를 누른 채로 {b} 키를 함께 누르세요.", { a: key![0], b: key!.slice(1).join(" + ") }) : key!.length > 1 ? t("Hold {a}, then press {b}.", "{a} 키를 누른 채로 {b} 키를 누르세요.", { a: key![0], b: key![1] }) : t("Press it on the keyboard.", "키보드에서 누르세요.")}
            {combo && key && (
              <>
                {" "}
                {t("Or hold {a}, then press {b}.", "또는 {a} 키를 누른 채로 {b} 키.", { a: key[0], b: key.slice(1).join(" + ") || key[0] })}
              </>
            )}{" "}
            <span className="ry-faint">{t("From {n}'s firmware.", "{n} 펌웨어 기준이에요.", { n: board.name })}</span>
          </p>
        </>
      ) : loading && deviceName ? (
        <p className="ry-unlock-note" tabIndex={-1} ref={firstFocus} style={{ outline: "none" }}>
          <span className="ry-faint">{t("Looking up {n}…", "{n} 찾는 중…", { n: deviceName })}</span>
        </p>
      ) : (
        <>
          {/* not one this site knows: keyboards set up here all start with this combo */}
          <div className="ry-unlock-keys" tabIndex={-1} ref={firstFocus}>
            <UnlockAnim keys={DEFAULT_COMBO} mode="together" />
          </div>
          <p className="ry-unlock-note">
            {L(
              <>
                Keyboards set up on this site unlock with <b>Esc + Backspace</b>, pressed together.{" "}
                <span className="ry-faint">
                  Otherwise it's the key its keymap gives <code>&amp;studio_unlock</code>, often on the Fn layer.
                </span>
              </>,
              <>
                이 사이트에서 만든 키보드는 <b>Esc + Backspace</b>를 동시에 누르면 풀려요.{" "}
                <span className="ry-faint">
                  아니라면 키맵에서 <code>&amp;studio_unlock</code>이 들어간 키예요. 보통 Fn 레이어에 있어요.
                </span>
              </>
            )}
          </p>
        </>
      )}
      <div className="ry-row ry-unlock-more">
        <span className="ry-faint">{t("Before you unlock", "잠금 해제 전에")}</span>
        <div className="ry-gap">
          <button className="ry-text" onClick={() => onTab("guide")}>{t("Guide", "가이드")}</button>
          <button className="ry-text" onClick={() => onTab("firmware")}>{t("Firmware", "펌웨어")}</button>
          {!inApp && <button className="ry-text" onClick={onApp}>{t("Desktop app", "데스크톱 앱")}</button>}
        </div>
      </div>
    </div>
  );
};
