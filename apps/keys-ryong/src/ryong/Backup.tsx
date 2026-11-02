import { useContext, useEffect, useRef, useState } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { getLang, t } from "./i18n";
import { createBackup, downloadBackup, KeymapBackup, listSnapshots, parseBackup, restoreBackup } from "./backup";

/* ---------------- Backup ---------------- */

const fmt = (iso: string) =>
  new Date(iso).toLocaleString(getLang() === "ko" ? "ko-KR" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const Backup = ({
  deviceName,
  onRestored,
}: {
  deviceName?: string;
  onRestored: () => void;
}) => {
  const { conn } = useContext(ConnectionContext);
  const lock = useContext(LockStateContext);
  const ready =
    !!conn && lock === LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED;
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [snaps, setSnaps] = useState<KeymapBackup[]>(listSnapshots());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSnaps(listSnapshots()), [deviceName]);

  const doBackup = async () => {
    if (!conn) return;
    setMsg(null);
    setBusy(t("Reading keymap…", "키맵 읽는 중…"));
    try {
      downloadBackup(await createBackup(conn, deviceName || "keyboard"));
      setMsg(t("Backup downloaded.", "백업 파일을 받았어요."));
    } catch (e) {
      setMsg(t("Couldn't back up. {e}", "백업하지 못했어요. {e}", { e: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async (b: KeymapBackup) => {
    if (!conn) return;
    if (
      b.device !== deviceName &&
      !confirm(
        t("This backup is from “{a}”. Apply it to “{b}”?", "“{a}”의 백업이에요. “{b}”에 적용할까요?", { a: b.device, b: deviceName || "" }),
      )
    )
      return;
    setMsg(null);
    setBusy(t("Restoring…", "복원 중…"));
    try {
      const r = await restoreBackup(conn, b, (d, total) =>
        setBusy(t("Restoring… {p}%", "복원 중… {p}%", { p: Math.round((d / total) * 100) })),
      );
      onRestored();
      setMsg(
        t(
          r.changed === 1 ? "Restored {n} key. Press Save at the top to keep it on the keyboard." : "Restored {n} keys. Press Save at the top to keep them on the keyboard.",
          "키 {n}개를 되돌렸어요. 키보드에 남기려면 위의 저장을 누르세요.",
          { n: r.changed },
        ) + (r.skipped.length ? t(" Skipped: {s}", " 건너뜀: {s}", { s: r.skipped.join(" / ") }) : ""),
      );
    } catch (e) {
      setMsg(t("Couldn't restore. {e}", "복원하지 못했어요. {e}", { e: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      await doRestore(parseBackup(await f.text()));
    } catch (e) {
      setMsg((e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <div className="ry-sec">
        <h1 className="ry-h1">{t("Backup", "백업")}</h1>
        <p className="ry-lead">
          {t(
            "Keys you change here are stored only on the keyboard. Back them up before updating firmware or restoring stock settings.",
            "여기서 바꾼 키는 키보드에만 저장돼요. 펌웨어를 업데이트하거나 기본 설정으로 되돌리기 전에 백업해 두세요.",
          )}
        </p>
      </div>

      {!ready && (
        <p className="ry-note">
          {conn
            ? t("Unlock the keyboard first.", "먼저 키보드 잠금을 풀어주세요.")
            : t("Connect a keyboard to back up or restore.", "백업하거나 복원하려면 키보드를 연결하세요.")}
        </p>
      )}

      <div className="ry-gap">
        <button
          className="ry-primary"
          disabled={!ready || !!busy}
          onClick={doBackup}
        >
          <Download /> {t("Back up keymap", "키맵 백업")}
        </button>
        <button
          className="ry-outline"
          disabled={!ready || !!busy}
          onClick={() => fileRef.current?.click()}
        >
          <Upload /> {t("Restore from file", "파일에서 복원")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {(busy || msg) && <p className="ry-note">{busy || msg}</p>}

      <hr className="ry-hr" />

      <div className="ry-sec">
        <div className="ry-row">
          <h2 className="ry-h2">{t("Saved here", "이 브라우저에 저장됨")}</h2>
          <span className="ry-faint">
            {t("Kept each time you save · last 5 per keyboard, this browser", "저장할 때마다 자동 기록 · 키보드별 최근 5개")}
          </span>
        </div>
        {snaps.length === 0 ? (
          <p className="ry-muted">{t("None yet.", "아직 없어요.")}</p>
        ) : (
          <ul className="ry-list">
            {snaps.map((s) => (
              <li key={s.createdAt + s.device}>
                <div>
                  <div>{s.device}</div>
                  <div className="ry-faint">
                    {fmt(s.createdAt)} · {t("{n} layers", "레이어 {n}개", { n: s.layers.length })}
                    {s.layout ? ` · ${s.layout}` : ""}
                  </div>
                </div>
                <div className="ry-gap">
                  <button
                    className="ry-icon"
                    title={t("Download", "다운로드")}
                    aria-label={t("Download", "다운로드")}
                    onClick={() => downloadBackup(s)}
                  >
                    <Download />
                  </button>
                  <button
                    className="ry-icon"
                    title={t("Restore this", "이걸로 복원")}
                    aria-label={t("Restore this", "이걸로 복원")}
                    disabled={!ready || !!busy}
                    onClick={() => doRestore(s)}
                  >
                    <RotateCcw />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
};

