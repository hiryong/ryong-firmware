import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { useSub } from "../usePubSub";
import { call_rpc } from "../rpc/logging";
import { createBackup, diffCount, KeymapBackup, latestSnapshot, restoreBackup, saveSnapshot } from "./backup";
import { getLang, L, t } from "./i18n";

const when = (iso: string) => new Date(iso).toLocaleString(getLang() === "ko" ? "ko-KR" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Remembers the keys each time they're saved, and when a keyboard comes back with different keys
 * (after a firmware update or a reset) offers to put them back. Works for everyone, no sign-in.
 */
export const KeysWatcher = ({ deviceName, onRestored }: { deviceName?: string; onRestored: () => void }) => {
  const { conn } = useContext(ConnectionContext);
  const lock = useContext(LockStateContext);
  const unlocked = lock === LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;
  const [offer, setOffer] = useState<{ prev: KeymapBackup; now: KeymapBackup; diff: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const hadUnsaved = useRef(false);

  // On connect: compare with the last saved keys of this keyboard.
  useEffect(() => {
    setOffer(null);
    if (!conn || !deviceName || !unlocked) return;
    let ignore = false;
    // Changes made in the editor but not saved yet also differ from the last save — that isn't the firmware's
    // doing, so only compare when the keyboard has nothing unsaved.
    call_rpc(conn, { keymap: { checkUnsavedChanges: true } })
      .then((r) => (r.keymap?.checkUnsavedChanges ? null : createBackup(conn, deviceName)))
      .then((now) => {
        if (ignore || !now) return;
        const prev = latestSnapshot(deviceName);
        const diff = prev ? diffCount(prev, now) : 0;
        if (prev && diff > 0) setOffer({ prev, now, diff });
        else saveSnapshot(now);
      })
      .catch((e) => console.warn("Snapshot failed", e));
    return () => {
      ignore = true;
    };
  }, [conn, deviceName, unlocked]);

  // After Save (or Discard): remember the keys as they now are on the keyboard.
  useSub("rpc_notification.keymap.unsavedChangesStatusChanged", (unsaved: boolean) => {
    if (unsaved) {
      hadUnsaved.current = true;
      // editing the keys as they are means keeping them: the offer to go back goes away
      setOffer(null);
      return;
    }
    if (!hadUnsaved.current || !conn || !deviceName) return;
    hadUnsaved.current = false;
    createBackup(conn, deviceName)
      .then(saveSnapshot)
      .catch(() => {});
  });

  if (!offer) return null;

  const putBack = async () => {
    if (!conn) return;
    setBusy(t("Putting your keys back…", "키를 되돌리는 중…"));
    try {
      await restoreBackup(conn, offer.prev);
      await call_rpc(conn, { keymap: { saveChanges: true } });
      onRestored();
      saveSnapshot({ ...offer.prev, createdAt: new Date().toISOString() });
      setOffer(null);
    } catch (e) {
      setBusy(t("Couldn't put them back. {e}", "되돌리지 못했어요. {e}", { e: (e as Error).message }));
      return;
    }
    setBusy(null);
  };

  const keep = () => {
    saveSnapshot(offer.now);
    setOffer(null);
  };

  return (
    <div className="ry-toast ry-offer" role="alert">
      <span>
        {busy ?? (
          <>
            {L(
              <>
                {offer.diff} key{offer.diff === 1 ? " is" : "s are"} not as you last saved them here ({when(offer.prev.createdAt)}). This happens after a settings reset, or if they were changed somewhere else.
              </>,
              <>
                이 컴퓨터에서 마지막으로 저장한 키({when(offer.prev.createdAt)})와 {offer.diff}개가 달라요. 설정을 초기화했거나 다른 곳에서 바꾼 경우에 생겨요.
              </>
            )}
          </>
        )}
      </span>
      {!busy?.endsWith("…") && (
        <span className="ry-gap">
          <button onClick={putBack}>{t("Put them back", "되돌리기")}</button>
          <button onClick={keep}>{t("Keep these", "지금 그대로")}</button>
        </span>
      )}
    </div>
  );
};
