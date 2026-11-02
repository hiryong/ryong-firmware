import { useContext, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import { LockStateContext } from "../rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import {
  chooseRepos,
  latestRun,
  listBranches,
  listTree,
  Me,
  readFile,
  commitFiles,
  Run,
  signIn,
  useMe,
} from "./api";
import {
  Board,
  cleanKeyboardName,
  links,
  matchesDevice,
  NAME_MAX,
  readKeyboardName,
  saveCatalog,
  slug,
  useCatalog,
  useMyBoards,
  writeKeyboardName,
} from "./keyboards";
import { createBackup, downloadBackup, saveSnapshot } from "./backup";
import { AccountRow, SignInPrompt } from "./SignIn";
import { L, t } from "./i18n";
import { KeyPress } from "./UnlockAnim";
import { FlashAnim } from "./Scenes";
import { KeyGeo, useBoardKeys } from "./boardKeys";
import { KeyboardEditor } from "./behaviors/BehaviorsEditor";
import { swapBaseWithLayer } from "./behaviors/keymapFile";

export const Firmware = ({ deviceName, onWide }: { deviceName?: string; onWide?: (wide: boolean) => void }) => {
  const me = useMe();
  // one keyboard opened for editing (its firmware contents), instead of the list
  const [editing, setEditing] = useState<Board | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => onWide?.(!!editing), [editing]);
  const open = (b: Board) => {
    setDirty(false);
    setEditing(b);
  };
  const onEditDefaults = open;
  const [catalog, setCatalog] = useCatalog();
  const mine = useMyBoards(me);
  // A shared keyboard's own template repository (the owner's) shows on the shared card, not twice.
  const templateOf = (b: Board) => (b.template ? mine.boards.find((m) => m.repo === b.template!.repo) : undefined);
  const [showShared, setShowShared] = useState(false);
  const myOwn = mine.boards.filter((m) => !(catalog || []).some((c) => c.template?.repo === m.repo));
  const all = [...(catalog || []), ...mine.boards];
  const anyLive = all.some((b) => matchesDevice(b, deviceName));
  const first = (list: Board[]) =>
    [...list].sort(
      (a, b) =>
        Number(matchesDevice(b, deviceName)) -
        Number(matchesDevice(a, deviceName)),
    );

  const editCatalog = me.user?.owner
    ? async (id: string, next: Board | null) => {
        const list = (catalog || []).flatMap((b) =>
          b.id !== id ? [b] : next ? [next] : [],
        );
        await saveCatalog(list);
        setCatalog(list);
      }
    : undefined;

  const editMine = async (b: Board, next: Board | null) => {
    const inRepo = mine.boards.filter((x) => x.repo === b.repo);
    await mine.saveRepo(
      b.repo,
      inRepo.flatMap((x) => (x.id !== b.id ? [x] : next ? [next] : [])),
    );
  };


  const sharedLive = (catalog || []).some((b) => matchesDevice(b, deviceName));
  // People with a keyboard of their own see it first; the shared list folds away below.
  const hasOwn = myOwn.length > 0;
  const sharedOpen = !hasOwn || showShared || sharedLive;
  const sharedSection =
    catalog && catalog.length > 0 ? (
      hasOwn && !sharedLive ? (
        <div className="ry-sec">
          <button className="ry-text ry-fold" aria-expanded={sharedOpen} onClick={() => setShowShared((v) => !v)}>
            {sharedOpen ? <ChevronDown /> : <ChevronRight />} {t("Shared keyboards", "공용 키보드")} · {catalog.length}
          </button>
          {sharedOpen && <>
          {first(catalog).map((b) => (
            <BoardCard
              key={b.id}
              b={b}
              live={matchesDevice(b, deviceName)}
              dim={anyLive && !matchesDevice(b, deviceName)}
              onSave={editCatalog && ((n) => editCatalog(b.id, n))}
              onRemove={editCatalog && (() => editCatalog(b.id, null))}
              onEditDefaults={templateOf(b) && onEditDefaults ? () => onEditDefaults(templateOf(b)!) : undefined}
              ownCopy={
                b.template
                  ? {
                      me,
                      have: mine.boards,
                      add: (nb) =>
                        mine.saveRepo(nb.repo, [
                          ...mine.boards.filter((x) => x.repo === nb.repo),
                          nb,
                        ]),
                    }
                  : undefined
              }
            />
          ))}
          </>}
        </div>
      ) : (
        <div className="ry-sec">
          <h2 className="ry-h2">{t("Shared", "공용")}</h2>
          {first(catalog).map((b) => (
            <BoardCard
              key={b.id}
              b={b}
              live={matchesDevice(b, deviceName)}
              dim={anyLive && !matchesDevice(b, deviceName)}
              onSave={editCatalog && ((n) => editCatalog(b.id, n))}
              onRemove={editCatalog && (() => editCatalog(b.id, null))}
              onEditDefaults={templateOf(b) && onEditDefaults ? () => onEditDefaults(templateOf(b)!) : undefined}
              ownCopy={
                b.template
                  ? {
                      me,
                      have: mine.boards,
                      add: (nb) =>
                        mine.saveRepo(nb.repo, [
                          ...mine.boards.filter((x) => x.repo === nb.repo),
                          nb,
                        ]),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )
    ) : null;
  const mineSection = (
<div className="ry-sec">
      <h2 className="ry-h2">{t("My keyboards", "내 키보드")}</h2>
      {!me.user || me.repos.length === 0 ? (
        <SignInPrompt title={t("Your keyboard", "내 키보드")}>
          {t(
            "Made one yours already? Sign in to see it.",
            "이미 내 것으로 만들었다면 로그인하세요.",
          )}
        </SignInPrompt>
      ) : (
        <>
          <AccountRow />
          {mine.loading && <p className="ry-muted">{t("Loading…", "불러오는 중…")}</p>}
          {mine.error && <p className="ry-note ry-danger">{mine.error}</p>}
          {first(myOwn).map((b) => (
            <BoardCard
              key={b.repo + b.id}
              b={b}
              live={matchesDevice(b, deviceName)}
              dim={anyLive && !matchesDevice(b, deviceName)}
              onOpen={() => open(b)}
            />
          ))}
          {!mine.loading && (
            <AddKeyboard
              me={me}
              deviceName={deviceName}
              taken={mine.boards}
              onAdd={(b) =>
                mine.saveRepo(b.repo, [
                  ...mine.boards.filter((x) => x.repo === b.repo),
                  b,
                ])
              }
            />
          )}
        </>
      )}
    </div>
  );

  if (editing) {
    const live = mine.boards.find((m) => m.repo === editing.repo && m.id === editing.id) ?? editing;
    const isTemplate = (catalog || []).some((c) => c.template?.repo === live.repo);
    return (
      <>
        <div className="ry-sec">
          <button
            className="ry-text ry-fold"
            onClick={() => (!dirty || confirm(t("Discard unsaved changes?", "저장하지 않은 변경 사항이 있어요. 버리고 나갈까요?"))) && setEditing(null)}
          >
            <ChevronLeft /> {t("My keyboards", "내 키보드")}
          </button>
          {isTemplate && (
            <p className="ry-note">
              {t(
                "Template: changes apply to new copies only.",
                "템플릿이에요. 여기서 바꾼 내용은 앞으로 만드는 복사본부터 적용돼요."
              )}
            </p>
          )}
          <BoardCard
            b={live}
            live={matchesDevice(live, deviceName)}
            onSave={(n) => editMine(live, n)}
            renamable
            onRemove={async () => {
              await editMine(live, null);
              setEditing(null);
            }}
          />
        </div>
        <KeyboardEditor board={live} connectedName={deviceName} onDirty={setDirty} />
      </>
    );
  }

  return (
    <>
      <div className="ry-sec">
        <h1 className="ry-h1">{t("Firmware", "펌웨어")}</h1>
        <p className="ry-lead">
          {t(
            import.meta.env.VITE_RYONG_RUNTIME === "1" ? "Runtime development firmware is not released. Back up keymaps and dynamic settings separately; upgrade compatibility is still under test." : "The latest firmware for each keyboard. Your keymap stays the same after an update.",
            import.meta.env.VITE_RYONG_RUNTIME === "1" ? "런타임 개발 펌웨어는 아직 배포하지 않습니다. 키맵과 동적 설정을 각각 백업하세요. 업데이트 호환성은 검증 중입니다." : "키보드별 최신 펌웨어예요. 업데이트해도 키맵은 그대로 유지돼요.",
          )}
        </p>
        {deviceName && !anyLive && !mine.loading && catalog && (
          <p className="ry-note">
            {me.user
              ? t(
                  "“{name}” isn't listed. Get its firmware from its maker.",
                  "목록에 없는 키보드예요 ({name}). 펌웨어는 제조사에서 받으세요.",
                  { name: deviceName },
                )
              : t(
                  "“{name}” isn't listed. Get its firmware from its maker.",
                  "목록에 없는 키보드예요 ({name}). 펌웨어는 제조사에서 받으세요.",
                  { name: deviceName },
                )}
          </p>
        )}
      </div>
      {hasOwn ? (
        <>
          {mineSection}
          {sharedSection}
        </>
      ) : (
        <>
          {sharedSection}
          {mineSection}
        </>
      )}
    </>
  );
};

// ---------- one keyboard ----------

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return t("{n} min ago", "{n}분 전", { n: Math.max(m, 1) });
  const h = Math.round(m / 60);
  if (h < 48) return t("{n} h ago", "{n}시간 전", { n: h });
  return t("{n} days ago", "{n}일 전", { n: Math.round(h / 24) });
};

const BuildStatus = ({ b }: { b: Board }) => {
  const [run, setRun] = useState<Run | null | undefined>(undefined);
  useEffect(() => {
    let ignore = false;
    latestRun(b.repo, b.workflow, b.branch)
      .then((r) => !ignore && setRun(r))
      .catch(() => !ignore && setRun(null));
    return () => {
      ignore = true;
    };
  }, [b.repo, b.workflow, b.branch]);
  if (run === undefined)
    return <span className="ry-faint">{t("Checking build…", "빌드 확인 중…")}</span>;
  if (run === null) return <span className="ry-faint">{t("No build info", "빌드 정보 없음")}</span>;
  const label =
    run.status !== "completed"
      ? t("Making new firmware…", "새 펌웨어 만드는 중…")
      : run.conclusion === "success"
        ? t("Firmware ready", "펌웨어 준비됨")
        : run.conclusion === "cancelled"
          ? t("Stopped", "중단됨")
          : t("Last change didn't work", "마지막 변경이 실패했어요");
  const bad = run.status === "completed" && run.conclusion !== "success";
  const state = run.status !== "completed" ? "is-busy" : run.conclusion === "success" ? "is-ok" : bad ? "is-bad" : "";
  return (
    <a
      className={`ry-pill ${bad ? "ry-danger" : ""}`}
      href={run.html_url}
      target="_blank"
      rel="noreferrer"
    >
      <span className={`ry-dot ${state}`} />
      {label} · {ago(run.updated_at)}
    </a>
  );
};

const BoardCard = ({
  b,
  live,
  dim,
  onSave,
  onRemove,
  ownCopy,
  onEditDefaults,
  onOpen,
  renamable,
}: {
  b: Board;
  live: boolean;
  dim?: boolean;
  onSave?: (next: Board) => Promise<void>;
  onRemove?: () => Promise<void>;
  ownCopy?: OwnCopyProps;
  /** a shared keyboard whose template is yours: edit what copies start with */
  onEditDefaults?: () => void;
  /** open this keyboard's editing view */
  onOpen?: () => void;
  /** own keyboards: the firmware's keyboard name can be changed too */
  renamable?: boolean;
}) => {
  // bootloader keys for the update steps (read from the keyboard when it is the connected one)
  const { keys } = useBoardKeys(b, live);
  const [update, setUpdate] = useState(false);
  const [copying, setCopying] = useState(false);
  const [edit, setEdit] = useState<Board | null>(null);
  // the firmware's keyboard name: loaded when editing starts (undefined = loading, null = not set)
  const [fwName, setFwName] = useState<
    { was: string | null; now: string } | undefined
  >(undefined);
  useEffect(() => {
    if (!edit || !renamable || fwName) return;
    readKeyboardName(b)
      .then((n) => setFwName({ was: n, now: n || "" }))
      .catch(() => setFwName({ was: null, now: "" }));
  }, [edit]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (f: () => Promise<void>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      setEdit(null);
      setMsg(done);
    } catch (e) {
      setMsg(`${t("Couldn't save.", "저장하지 못했어요.")} ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`ry-card ${dim ? "is-dim" : ""}`}>
      {edit ? (
        <div className="ry-sec">
          <div className="ry-field">
            <span className="ry-label">{t("Name", "이름")}</span>
            <input
              type="text"
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </div>
          <div className="ry-field">
            <span className="ry-label">{t("Description", "설명")}</span>
            <input
              type="text"
              value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
            />
          </div>
          {renamable && (
            <div className="ry-field">
              <span className="ry-label">
                {t(
                  "Keyboard name (shown in Bluetooth)",
                  "키보드 이름 (블루투스에 표시)",
                )}
              </span>
              <input
                type="text"
                maxLength={NAME_MAX}
                disabled={!fwName}
                placeholder={fwName ? t("Board default", "보드 기본값") : t("Loading…", "불러오는 중…")}
                value={fwName?.now ?? ""}
                onChange={(e) =>
                  fwName && setFwName({ ...fwName, now: e.target.value })
                }
              />
              <span className="ry-faint">
                {t(
                  "Up to {n} letters.",
                  "최대 {n}자.",
                  { n: NAME_MAX },
                )}
              </span>
            </div>
          )}
          <div className="ry-field">
            <span className="ry-label">
              {t(
                "Recognised by the name the keyboard reports",
                "키보드가 보내는 이름으로 구분해요",
              )}
            </span>
            <input
              type="text"
              value={edit.match.join(", ")}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  match: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div className="ry-row">
            <div className="ry-gap">
              <button
                className="ry-primary"
                disabled={busy}
                onClick={() => {
                  const newName = fwName ? cleanKeyboardName(fwName.now) : "";
                  const renamed =
                    !!fwName && !!newName && newName !== fwName.was;
                  run(
                    async () => {
                      if (renamed) await writeKeyboardName(b, newName);
                      await onSave!({
                        ...edit,
                        name: edit.name.trim() || b.name,
                        match: renamed
                          ? [...new Set([...edit.match, newName])]
                          : edit.match,
                      });
                      if (renamed) setFwName({ was: newName, now: newName });
                    },
                    renamed
                      ? t(
                          "Saved. Update the firmware to use “{name}” (you may need to pair again).",
                          "저장했어요. 펌웨어를 업데이트하면 새 이름이 적용돼요. 블루투스는 다시 연결해야 할 수 있어요.",
                          { name: newName },
                        )
                      : t("Saved.", "저장했어요."),
                  );
                }}
              >
                {busy ? t("Saving…", "저장 중…") : t("Save", "저장")}
              </button>
              <button
                className="ry-text"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                {t("Cancel", "취소")}
              </button>
            </div>
            {onRemove && (
              <button
                className="ry-text ry-danger"
                disabled={busy}
                onClick={() =>
                  confirm(
                    t(
                      "Remove “{name}” from this list? Its files are kept.",
                      "목록에서 “{name}” 키보드를 뺄까요? 파일은 지워지지 않아요.",
                      { name: b.name },
                    ),
                  ) && run(onRemove, t("Removed.", "삭제했어요."))
                }
              >
                <Trash2
                  style={{
                    width: 14,
                    height: 14,
                    display: "inline",
                    marginRight: 6,
                  }}
                />
                {t("Remove", "삭제")}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="ry-row">
          <div>
            <div className="ry-card-t">{b.name}</div>
            {b.note && <div className="ry-card-m">{b.note}</div>}
          </div>
          <div className="ry-gap">
            {onSave && (
              <button
                className="ry-icon"
                title={t("Edit", "편집")}
                aria-label={t("Edit", "편집")}
                onClick={() => setEdit(b)}
              >
                <Pencil />
              </button>
            )}
            {live && (
              <span className="ry-pill is-live" role="status">
                <span className="ry-live-dot" aria-hidden="true" />
                {t("Connected", "연결됨")}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="ry-row">
        <BuildStatus b={b} />
      </div>

      <div className="ry-gap">
        {ownCopy && (
          <button className="ry-primary" aria-expanded={copying} onClick={() => setCopying((v) => !v)}>
            {t("Make it yours", "내 것으로 만들기")}
          </button>
        )}
        <button className={ownCopy ? "ry-outline" : "ry-outline"} aria-expanded={update} onClick={() => setUpdate((v) => !v)}>
          <Download /> {ownCopy ? t("Just the firmware", "펌웨어만 받기") : t("Update firmware", "펌웨어 업데이트")}
        </button>
        {onOpen && (
          <button className="ry-primary" onClick={onOpen}>
            <Pencil /> {t("Edit", "편집")}
          </button>
        )}
        {onEditDefaults && (
          <button className="ry-text" onClick={onEditDefaults} title={t("Defaults for new copies", "새 복사본의 기본값")}>
            {t("Edit defaults", "기본값 편집")}
          </button>
        )}
      </div>
      {ownCopy && !copying && (
        <p className="ry-faint" style={{ margin: 0 }}>
          {t(
            "Make it yours to set your own name, combos, macros and settings.",
            "내 것으로 만들면 이름, 콤보, 매크로, 설정을 직접 바꿀 수 있어요."
          )}
        </p>
      )}

      {update && <UpdateFlow b={b} live={live} bootloader={keys?.bootloader} bootloaderKeys={keys?.bootloaderKeys} />}
      {copying && ownCopy && <OwnCopy b={b} {...ownCopy} />}
      {msg && <p className="ry-faint">{msg}</p>}
    </article>
  );
};

// ---------- the update, step by step ----------

const UpdateFlow = ({ b, live, bootloader, bootloaderKeys }: { b: Board; live: boolean; bootloader?: string[]; bootloaderKeys?: KeyGeo[] }) => {
  const boot = bootloader?.join(" + ");
  const [got, setGot] = useState(false);
  const { conn } = useContext(ConnectionContext);
  const lock = useContext(LockStateContext);
  const ready =
    !!conn && lock === LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED && live;
  const [saved, setSaved] = useState<"no" | "busy" | "yes" | "skip">("no");
  const [err, setErr] = useState<string | null>(null);

  const keep = async () => {
    if (!conn) return;
    setSaved("busy");
    setErr(null);
    try {
      const bk = await createBackup(conn, b.name);
      saveSnapshot(bk);
      downloadBackup(bk);
      setSaved("yes");
    } catch (e) {
      setErr((e as Error).message);
      setSaved("no");
    }
  };

  return (
    <ol className="ry-steps">
      <li>
        <span>
          <b>{t("Keep your keys.", "키 배치 지키기.")}</b>{" "}
          {saved === "yes" ? (
            <span className="ry-ok">
              <Check /> {t("Saved here and downloaded.", "여기에 저장하고 파일로도 받았어요.")}
            </span>
          ) : ready ? (
            <button
              className="ry-text"
              style={{ padding: 0 }}
              disabled={saved === "busy"}
              onClick={keep}
            >
              {saved === "busy" ? t("Saving…", "저장 중…") : t("Save them now", "지금 저장하기")}
            </button>
          ) : (
            <>
              {t(
                "Connect and unlock first, so your keys can be restored.",
                "키맵을 되돌리려면 먼저 키보드를 연결하고 잠금을 풀어 주세요.",
              )}{" "}
              {saved !== "skip" && (
                <button
                  className="ry-text"
                  style={{ padding: 0 }}
                  onClick={() => setSaved("skip")}
                >
                  {t("Skip", "건너뛰기")}
                </button>
              )}
            </>
          )}
          {err && <span className="ry-danger"> {err}</span>}
        </span>
      </li>
      <li>
        <span>
          {L(
            <>
              <a
                className={saved === "no" && ready ? "ry-link is-wait" : "ry-link"}
                href={links(b).firmware}
                onClick={() => setGot(true)}
              >
                Download the latest firmware
              </a>{" "}
              and unzip it to get the .uf2 file.
            </>,
            <>
              <a
                className={saved === "no" && ready ? "ry-link is-wait" : "ry-link"}
                href={links(b).firmware}
                onClick={() => setGot(true)}
              >
                최신 펌웨어를 다운로드
              </a>
              하고 압축을 풀어 .uf2 파일을 꺼내세요.
            </>,
          )}
        </span>
      </li>
      <li>
        <span>
          {L(
            <>
              Plug the keyboard in by USB and start its bootloader —{" "}
              {boot ? (
                <>
                  <span className="ry-code">{boot}</span>, or
                  double-press the reset button.
                </>
              ) : (
                "usually by double-pressing the reset button."
              )}{" "}
              A new USB drive appears.
            </>,
            <>
              키보드를 USB로 연결하고 부트로더를 켜세요 —{" "}
              {boot ? (
                <>
                  <span className="ry-code">{boot}</span> 키를 누르거나 리셋 버튼을 두 번
                  누르면 돼요.
                </>
              ) : (
                "보통 리셋 버튼을 두 번 누르면 돼요."
              )}{" "}
              새 USB 드라이브가 나타나요.
            </>,
          )}
          {got && bootloader && (
            <span className="ry-anim" aria-label={t("Bootloader: {k}", "부트로더: {k}", { k: boot! })}>
              <KeyPress
                keys={bootloaderKeys ?? bootloader.map((label, i) => ({ label, x: i * 300, y: 0, w: 100 }))}
                mode={bootloader.length > 1 ? "hold" : "single"}
              />
            </span>
          )}
        </span>
      </li>
      <li>
        <span>
          {t(
            "Drag the .uf2 onto that drive. It restarts by itself.",
            ".uf2 파일을 그 드라이브에 끌어다 놓으세요. 키보드가 자동으로 다시 시작돼요.",
          )}
          {got && (
            <span className="ry-anim">
              <FlashAnim />
            </span>
          )}
        </span>
      </li>
      <li>
        <span>
          {t(
            "Connect again. Changed keys can be restored.",
            "다시 연결하세요. 키맵이 바뀌었다면 이전 상태로 되돌릴 수 있어요.",
          )}
        </span>
      </li>
    </ol>
  );
};

// ---------- adding one of your own ----------

const AddKeyboard = ({
  me,
  deviceName,
  taken,
  onAdd,
}: {
  me: Me;
  deviceName?: string;
  taken: Board[];
  onAdd: (b: Board) => Promise<void>;
}) => {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(me.repos[0]?.full_name || "");
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [found, setFound] = useState<{
    keymaps: string[];
    workflows: string[];
  } | null>(null);
  const [form, setForm] = useState({
    name: deviceName || "",
    note: "",
    keymap: "",
    workflow: "build.yml",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !repo) return;
    setBranches([]);
    setBranch("");
    listBranches(repo)
      .then((bs) => {
        setBranches(bs);
        setBranch(
          bs.includes(
            me.repos.find((r) => r.full_name === repo)?.default_branch || "",
          )
            ? me.repos.find((r) => r.full_name === repo)!.default_branch
            : bs[0] || "",
        );
      })
      .catch((e) => setErr(e.message));
  }, [open, repo]);

  useEffect(() => {
    if (!branch) return;
    setFound(null);
    listTree(repo, branch)
      .then((files) => {
        const keymaps = files
          .filter((f) => f.endsWith(".keymap"))
          .sort(
            (a, b) =>
              Number(b.startsWith("config/")) - Number(a.startsWith("config/")),
          );
        const workflows = files
          .filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f))
          .map((f) => f.split("/").pop()!);
        setFound({ keymaps, workflows });
        setForm((x) => ({
          ...x,
          keymap: keymaps[0] || "",
          workflow: workflows.includes("build.yml")
            ? "build.yml"
            : workflows[0] || "build.yml",
        }));
      })
      .catch((e) => setErr(e.message));
  }, [repo, branch]);

  if (!open)
    return (
      <button className="ry-ghost ry-add" onClick={() => setOpen(true)}>
        <Plus /> {t("Add a keyboard", "키보드 추가")}
      </button>
    );

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      let id = slug(form.name || branch);
      while (taken.some((t) => t.repo === repo && t.id === id)) id += "-2";
      await onAdd({
        id,
        name: form.name.trim() || branch,
        note: form.note.trim(),
        repo,
        branch,
        workflow: form.workflow,
        artifact: "firmware",
        keymap: form.keymap,
        match: [deviceName || form.name.trim()].filter(Boolean),
      });
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ry-card">
      <div className="ry-card-t">{t("Add a keyboard", "키보드 추가")}</div>
      <div className="ry-two">
        <div className="ry-field">
          <span className="ry-label">{t("Repository", "저장소")}</span>
          <select value={repo} onChange={(e) => setRepo(e.target.value)}>
            {me.repos.map((r) => (
              <option key={r.full_name}>{r.full_name}</option>
            ))}
          </select>
        </div>
        <div className="ry-field">
          <span className="ry-label">{t("Branch", "브랜치")}</span>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={!branches.length}
          >
            {branches.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="ry-two">
        <div className="ry-field">
          <span className="ry-label">{t("Name", "이름")}</span>
          <input
            type="text"
            value={form.name}
            placeholder={branch}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="ry-field">
          <span className="ry-label">{t("Description (optional)", "설명 (선택)")}</span>
          <input
            type="text"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
      </div>
      {found && (
        <div className="ry-two">
          <div className="ry-field">
            <span className="ry-label">{t("Keymap file", "키맵 파일")}</span>
            <select
              value={form.keymap}
              onChange={(e) => setForm({ ...form, keymap: e.target.value })}
            >
              {found.keymaps.length === 0 && (
                <option value="">{t("None found", "찾지 못했어요")}</option>
              )}
              {found.keymaps.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="ry-field">
            <span className="ry-label">{t("Build workflow", "빌드 워크플로")}</span>
            <select
              value={form.workflow}
              onChange={(e) => setForm({ ...form, workflow: e.target.value })}
            >
              {(found.workflows.length ? found.workflows : ["build.yml"]).map(
                (w) => (
                  <option key={w}>{w}</option>
                ),
              )}
            </select>
          </div>
        </div>
      )}
      {deviceName && (
        <p className="ry-faint">
          {t(
            "It will be recognised when “{name}” is connected.",
            "“{name}” 키보드를 연결하면 자동으로 찾아요.",
            { name: deviceName },
          )}
        </p>
      )}
      {err && <p className="ry-note ry-danger">{err}</p>}
      <div className="ry-gap">
        <button className="ry-primary" disabled={busy || !branch} onClick={add}>
          {busy ? t("Adding…", "추가 중…") : t("Add", "추가")}
        </button>
        <button className="ry-text" onClick={() => setOpen(false)}>
          {t("Cancel", "취소")}
        </button>
      </div>
    </div>
  );
};

// ---------- a config of your own, for people who don't have one ----------

interface OwnCopyProps {
  me: Me & { loading: boolean };
  have: Board[];
  add: (b: Board) => Promise<void>;
}

/**
 * For a shared keyboard: copy its template into your own GitHub account, let this site use the copy,
 * and add it to My keyboards. From then on the firmware, combos and macros are yours to change.
 */
const OwnCopy = ({ b, me, have, add }: { b: Board } & OwnCopyProps) => {
  const tpl = b.template!;
  const [owner, name] = tpl.repo.split("/");
  const suggested = `zmk-config-${slug(b.name)}`;
  const createUrl = `https://github.com/new?template_owner=${encodeURIComponent(owner)}&template_name=${encodeURIComponent(name)}&name=${encodeURIComponent(suggested)}&description=${encodeURIComponent(`My ${b.name} keyboard`)}`;
  // A copy the site can already use, and that isn't in My keyboards yet.
  const candidates = me.repos.filter(
    (r) => r.full_name !== tpl.repo && !have.some((h) => h.repo === r.full_name),
  );
  const guess =
    candidates.find((r) => r.full_name.endsWith("/" + suggested)) ??
    candidates[0];
  const [repo, setRepo] = useState(guess?.full_name || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [kbName, setKbName] = useState(b.name);
  const [os, setOs] = useState<"windows" | "mac">(tpl.os?.base ?? "windows");
  useEffect(() => setRepo(guess?.full_name || ""), [guess?.full_name]);

  const go = async () => {
    const r = me.repos.find((x) => x.full_name === repo);
    if (!r) return;
    setBusy(true);
    setErr(null);
    try {
      const name = cleanKeyboardName(kbName) || b.name;
      const board: Board = {
        ...b,
        id: slug(name),
        name,
        repo: r.full_name,
        branch: r.default_branch,
        keymap: tpl.keymap,
        workflow: tpl.workflow || b.workflow,
        note: `My ${b.name}`,
        match: [...new Set([name, ...b.match])],
        private: r.private,
        template: undefined,
      };
      // A name of your own goes into the firmware (this also starts its first build with that name).
      if (name !== b.name) await writeKeyboardName(board, name);
      // The other OS on the base layer: swap it with its layer in the copy's keymap.
      if (tpl.os && os !== tpl.os.base) {
        const km = await readFile(board.repo, board.branch, board.keymap);
        if (km)
          await commitFiles(
            board.repo,
            board.branch,
            [{ path: board.keymap, content: swapBaseWithLayer(km, tpl.os.layer) }],
            `Base layout: ${os === "mac" ? "Mac" : "Windows"} (the other one on Fn + Tab)\n\nSaved from keys.ryong.com`
          );
      }
      await add(board);
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ry-sec">
      <p className="ry-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
        {t(
          "Your firmware is kept and built in a free GitHub account. Set it up once (about 2 minutes); after that, everything happens here.",
          "내 펌웨어는 무료 GitHub 계정에 저장되고, 거기서 만들어져요. 처음 한 번만 연결하면(2분 정도) 나머지는 모두 여기서 할 수 있어요.",
        )}
      </p>
      <ol className="ry-steps">
        <li>
          <span>
            <a
              className="ry-link"
              href={createUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("Open GitHub", "GitHub 열기")}
            </a>{" "}
            {L(
              <>
                — sign up or sign in if asked, leave everything as it is and press the green{" "}
                <b>Create repository</b> button.
              </>,
              <>
                — 가입이나 로그인을 하라고 하면 하고, 나머지는 그대로 둔 채 초록색{" "}
                <b>Create repository</b> 버튼만 누르세요.
              </>,
            )}
          </span>
        </li>
        <li>
          <span>
            {!me.enabled ? (
              t(
                "Let this site use it (sign-in isn't set up yet).",
                "이 사이트에 사용 권한을 주세요 (로그인이 아직 설정되지 않음).",
              )
            ) : !me.user ? (
              <>
                <button className="ry-link" onClick={signIn}>
                  {t("Sign in with GitHub", "GitHub로 로그인")}
                </button>
                {t(", then come back here.", "한 뒤 여기로 돌아오세요.")}
              </>
            ) : (
              <>
                <button className="ry-link" onClick={chooseRepos}>
                  {t("Connect it to this site", "이 사이트에 연결하기")}
                </button>{" "}
                {t("— tick the one you just made and press Save.", "— 방금 만든 저장소를 체크하고 Save를 누르세요.")}
              </>
            )}
          </span>
        </li>
        <li>
          <span>
            {done ? (
              <span className="ry-ok">
                <Check />{" "}
                {t(
                  "Added to My keyboards. Update the firmware once it's ready.",
                  "내 키보드에 추가했어요. 펌웨어가 준비되면 업데이트하세요.",
                )}
              </span>
            ) : candidates.length > 0 ? (
              <>
                <span style={{ display: "block", marginBottom: 6 }}>
                  {t(
                    "Name it (shown in Bluetooth) and add it.",
                    "블루투스에 표시될 이름을 정하고 추가하세요.",
                  )}
                </span>
                <span className="ry-gap">
                  <input
                    type="text"
                    aria-label={t("Keyboard name", "키보드 이름")}
                    title={t(
                      "Shown in Bluetooth",
                      "블루투스에 보이는 이름",
                    )}
                    maxLength={NAME_MAX}
                    value={kbName}
                    onChange={(e) => setKbName(e.target.value)}
                    style={{ width: 150 }}
                  />
                  {tpl.os && (
                    <select value={os} onChange={(e) => setOs(e.target.value as "windows" | "mac")} aria-label={t("Base layout", "기본 배열")}>
                      <option value="windows">{t("Windows layout", "Windows 배열")}</option>
                      <option value="mac">{t("Mac layout", "Mac 배열")}</option>
                    </select>
                  )}
                  {candidates.length > 1 && (
                    <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label={t("Your copy", "내 복사본")}>
                      {candidates.map((r) => (
                        <option key={r.full_name} value={r.full_name}>
                          {r.full_name.split("/")[1]}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="ry-outline"
                    disabled={busy || !repo}
                    onClick={go}
                  >
                    {busy ? t("Setting up…", "준비 중…") : t("Done", "완료")}
                  </button>
                </span>
              </>
            ) : (
              t(
                "Name your keyboard — this appears once it's connected.",
                "키보드 이름 정하기 — 연결하면 이 단계가 나와요.",
              )
            )}
          </span>
        </li>
      </ol>
      {err && <p className="ry-note ry-danger">{err}</p>}
    </div>
  );
};

