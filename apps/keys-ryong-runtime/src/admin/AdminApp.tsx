// keysbeta.ryong.com/admin — firmware builds, bench-test records, releases and status for the owner.
// Talks only to /api/admin (Cloudflare Functions). GitHub is used behind the server; no GitHub sign-in here.
// English or Korean with the main app's switch (ryong/i18n, same "ryong.lang" choice); the API answers in the language sent as X-Ryong-Lang.
// data-ry-i18n-skip: the main app's swapping of official ZMK Studio texts never touches this page.
import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { RyongMark } from "../ryong/RyongMark";
import { LangToggle } from "../ryong/LangToggle";
import { getLang, t, useLang } from "../ryong/i18n";
import checklist from "../../admin-functions/_lib/checklist.json";
import { evaluate, ItemState } from "../../admin-functions/_lib/rules";

type Me = { signedIn: boolean; setup: { password: "ok" | "no-password" | "weak-password"; github: boolean }; repo: string; ref: string };
type Check = { file: string; label: string; status: string; conclusion: string | null; url: string | null; at: string | null; sha: string | null };
type ChannelEntry = { run_id: number; tag: string; uf2_sha256: string; released_at: string; url: string };
type Channels = { [target: string]: { beta?: ChannelEntry; stable?: ChannelEntry } };
type BuildRow = { id: number; target?: string; label?: string; status: string; conclusion: string | null; at: string; sha?: string; url: string; validated?: boolean };
type Detail = {
  id: number; target: string; label?: string; status: string; conclusion: string | null; url: string; at: string; sha: string;
  artifact: { uf2_sha256: string; expired: boolean; size: number; expires_at: string } | null;
  record: { tested_board: string; items: { [id: string]: ItemState }; notes: string; result: string; tested_at: string; stable_ready: boolean } | null;
  released: ("beta" | "stable")[]; blockers: { beta: string[]; stable: string[] };
};

/** A checklist item or board in the current language ("label" is Korean, "label_en" English). */
const labelOf = (x: { label: string; label_en?: string }) => t(x.label_en ?? x.label, x.label);

const TARGET_LABEL: { [k: string]: string } = { bt60: "BT60 Cheeto", "bt60-oreo": "BT60 Oreo", ryong60: "Ryong60" };
const ago = (iso?: string | null) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t("just now", "방금");
  if (s < 3600) return t("{n} min ago", "{n}분 전", { n: Math.floor(s / 60) });
  if (s < 86400) return t("{n} h ago", "{n}시간 전", { n: Math.floor(s / 3600) });
  return new Date(iso).toLocaleDateString(getLang() === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" });
};

class ApiError extends Error { constructor(public status: number, message: string, public blockers?: string[]) { super(message); } }
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`/api/admin${path}`, {
    ...init, credentials: "same-origin",
    headers: { "X-Ryong-Lang": getLang(), ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.method && init.method !== "GET" ? { "X-Ryong-Admin": "1" } : {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error || t("Error ({status})", "오류 ({status})", { status: r.status }), data.blockers);
  return data as T;
}

function Dot({ run }: { run: { status: string; conclusion: string | null } }) {
  const s = run.status !== "completed" && run.status !== "none" ? "busy" : run.conclusion === "success" ? "ok" : run.conclusion ? "bad" : "none";
  const label = { busy: t("In progress", "진행 중"), ok: t("Succeeded", "성공"), bad: t("Failed", "실패"), none: t("No runs", "기록 없음") }[s];
  return <span className={`kc-dot is-${s}`} role="img" aria-label={label} title={label} />;
}

export function AdminApp() {
  useLang();
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<"status" | "build" | "test" | "release">("status");
  const [focus, setFocus] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = useCallback(() => api<Me>("/me").then((m) => { setMe(m); return m; }).catch((e) => { setError(e.message); return null; }), []);
  useEffect(() => { refreshMe(); }, [refreshMe]);
  const onAuthError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) refreshMe();
    else setError((e as Error).message);
  }, [refreshMe]);

  if (!me) return <div className="kc-shell" data-ry-i18n-skip><p className="ry-faint kc-center">{error ?? t("Loading…", "불러오는 중…")}</p></div>;
  if (!me.signedIn) return <Login me={me} onDone={refreshMe} />;

  const go = (to: typeof tab, id?: number) => { setTab(to); if (id) setFocus(id); window.scrollTo(0, 0); };
  return (
    <div className="kc-shell" data-ry-i18n-skip>
      <header className="kc-top">
        <a className="kc-brand" href="/"><RyongMark size={20} /> Keys <span className="ry-faint">{t("Admin", "관리자")}</span></a>
        <nav className="kc-tabs" aria-label={t("Admin menu", "관리 메뉴")}>
          {([["status", t("Status", "현황")], ["build", t("Build", "빌드")], ["test", t("Bench test", "실기 검증")], ["release", t("Release", "배포")]] as const).map(([id, label]) =>
            <button key={id} className="ry-tab" aria-pressed={tab === id} onClick={() => go(id)}>{label}</button>)}
        </nav>
        <div className="kc-top-end">
          <LangToggle />
          <button className="ry-text" onClick={() => api("/logout", { method: "POST" }).finally(refreshMe)}>{t("Sign out", "로그아웃")}</button>
        </div>
      </header>
      <main className="kc-main">
        {!me.setup.github && <p className="ry-note ry-danger" role="alert">{t("The GitHub token (ADMIN_GITHUB_TOKEN) is not set yet, so builds, bench tests and releases are unavailable.", "GitHub 토큰(ADMIN_GITHUB_TOKEN)이 아직 설정되지 않아서 빌드·검증·배포를 쓸 수 없어요.")}</p>}
        {error && <p className="ry-note ry-danger" role="alert">{error} <button className="ry-text" onClick={() => setError(null)}>{t("Dismiss", "닫기")}</button></p>}
        {tab === "status" && <Status onError={onAuthError} go={go} me={me} />}
        {tab === "build" && <Build onError={onAuthError} go={go} />}
        {tab === "test" && <Test onError={onAuthError} focus={focus} setFocus={setFocus} go={go} />}
        {tab === "release" && <Release onError={onAuthError} focus={focus} setFocus={setFocus} />}
      </main>
    </div>
  );
}

function Login({ me, onDone }: { me: Me; onDone: () => Promise<Me | null> }) {
  useLang();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api("/login", { method: "POST", body: JSON.stringify({ password: pw }) });
      const m = await onDone();
      if (!m?.signedIn) setError(t("The password was right, but the sign-in cookie wasn't saved. Check for a private window or a setting or extension that blocks cookies.",
        "비밀번호는 맞았지만 로그인 쿠키가 저장되지 않았어요. 시크릿 창이거나 쿠키를 막는 설정·확장 프로그램이 있는지 확인하세요."));
      else setPw("");
    }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const blocked = me.setup.password !== "ok";
  return (
    <div className="kc-shell kc-login" data-ry-i18n-skip>
      <form className="ry-card kc-login-card" onSubmit={submit}>
        <div className="kc-login-top"><div className="kc-brand"><RyongMark size={24} /> Keys <span className="ry-faint">{t("Admin", "관리자")}</span></div><LangToggle /></div>
        {blocked ? <p className="ry-note">{me.setup.password === "no-password" ? t("No admin password is set yet.", "관리자 비밀번호가 아직 설정되지 않았어요.") : t("The configured password is too short. Change it to 10 or more characters.", "설정된 비밀번호가 너무 짧아요. 10자 이상으로 바꿔 주세요.")}{" "}
          {t("Set ADMIN_PASSWORD in the GitHub repository secrets and redeploy keysbeta to open it.", "GitHub 저장소 Secrets의 ADMIN_PASSWORD를 설정하고 keysbeta를 다시 배포하면 열려요.")}</p>
          : <>
            <label className="ry-field"><span className="ry-label">{t("Password", "비밀번호")}</span>
              <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required /></label>
            {error && <p className="ry-faint ry-danger" role="alert">{error}</p>}
            <button className="ry-primary" disabled={busy || !pw}>{busy ? t("Checking…", "확인 중…") : t("Sign in", "로그인")}</button>
          </>}
      </form>
    </div>
  );
}

function useLoad<T>(path: string | null, onError: (e: unknown) => void, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const lang = useLang();  // server texts (errors, blockers, check names) come in the page's language: fetch again on a switch
  const load = useCallback(() => {
    if (!path) { setData(null); return; }
    setLoading(true);
    api<T>(path).then(setData).catch(onError).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, lang, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) =>
  <section className="kc-sec"><div className="kc-sec-h"><h2>{title}</h2>{action}</div>{children}</section>;

function ChannelCards({ channels }: { channels: Channels }) {
  return <div className="kc-grid">
    {Object.keys(TARGET_LABEL).map((target) => <div key={target} className="ry-card">
      <div className="ry-card-t">{TARGET_LABEL[target]}</div>
      {(["stable", "beta"] as const).map((ch) => {
        const c = channels[target]?.[ch];
        return <div key={ch} className="kc-row">
          <span className="kc-chan">{ch === "stable" ? t("Stable", "정식") : t("Beta", "베타")}</span>
          {c ? <><a href={c.url} target="_blank" rel="noreferrer">r{c.run_id}</a><span className="ry-faint">{ago(c.released_at)}</span></>
            : <span className="ry-faint">{t("None yet", "아직 없음")}</span>}
        </div>;
      })}
    </div>)}
  </div>;
}

function Status({ onError, go, me }: { onError: (e: unknown) => void; go: (to: "build" | "test", id?: number) => void; me: Me }) {
  const { data, loading, reload } = useLoad<{ checks: Check[]; builds: BuildRow[]; channels: Channels; zmk: ZmkUpdate | null }>(me.setup.github ? "/overview" : null, onError);
  return <>
    {data?.zmk?.candidate && <ZmkNotice z={data.zmk} />}
    <Section title={t("Released firmware", "배포 중인 펌웨어")} action={<button className="ry-text" onClick={reload} disabled={loading}>{loading ? t("Loading…", "불러오는 중…") : t("Refresh", "새로고침")}</button>}>
      <ChannelCards channels={data?.channels ?? {}} />
    </Section>
    <Section title={`${t("Automated checks", "자동 검사")} · ${me.ref}`}>
      <div className="kc-list">
        {(data?.checks ?? []).map((c) => <div key={c.file} className="kc-item">
          <Dot run={c} /><span className="kc-item-t">{c.label}</span>
          <span className="ry-faint">{c.sha ?? ""} {ago(c.at)}</span>
          {c.url && <a className="ry-text" href={c.url} target="_blank" rel="noreferrer">{t("Log", "기록")}</a>}
        </div>)}
        {!data && !loading && <p className="ry-faint">{t("Nothing to show.", "표시할 내용이 없어요.")}</p>}
      </div>
    </Section>
    <Section title={t("Recent builds", "최근 빌드")} action={<button className="ry-outline" onClick={() => go("build")}>{t("New build", "새 빌드")}</button>}>
      <BuildList rows={data?.builds ?? []} go={go} />
    </Section>
  </>;
}

type ZmkUpdate = {
  checked_at: string; current: { zmk: string; label: string }; latest_release: string | null;
  candidate?: { release: string; status: "ready" | "needs_work" | "failed"; summary: string; overlaps?: string[];
    builds?: { target: string; run: number }[]; prepared_at: string; details_url?: string };
};
const zmkStatus = (s: "ready" | "needs_work" | "failed") =>
  ({ ready: t("Ready for install testing", "설치 테스트 가능"), needs_work: t("Needs a look", "확인 필요"), failed: t("Build failed", "빌드 실패") })[s];

/** A new official ZMK release, already combined with our modules and judged (third_party/zmk/README.md). */
function ZmkNotice({ z }: { z: ZmkUpdate }) {
  const c = z.candidate!;
  return <Section title={`${t("New official ZMK release", "새 ZMK 정식 버전")} · ${c.release}`}>
    <div className="kc-card kc-notice">
      <div className="kc-row"><span className={`kc-dot ${c.status === "ready" ? "is-ok" : c.status === "failed" ? "is-bad" : "is-busy"}`} />
        <strong>{zmkStatus(c.status)}</strong><span className="ry-faint">{t("Now {v}", "지금 {v}", { v: z.current.label })} · {ago(c.prepared_at)}</span></div>
      <p className="kc-notice-t">{c.summary}</p>
      {!!c.overlaps?.length && <ul className="kc-why">{c.overlaps.map((o) => <li key={o}>{o}</li>)}</ul>}
      <div className="kc-row">
        {(c.builds ?? []).map((b) => <span key={b.run} className="ry-faint">{TARGET_LABEL[b.target] ?? b.target} r{b.run}</span>)}
        {c.details_url && <a className="ry-text" href={c.details_url} target="_blank" rel="noreferrer">{t("Details", "자세히")}</a>}
      </div>
      <p className="ry-faint">{t("As always, an installable release needs a bench-test record first.", "설치용 배포는 지금처럼 검증 기록을 남긴 뒤에만 할 수 있어요.")}</p>
    </div>
  </Section>;
}

function BuildList({ rows, go }: { rows: BuildRow[]; go: (to: "test", id?: number) => void }) {
  if (!rows.length) return <p className="ry-faint">{t("No builds yet.", "아직 빌드가 없어요.")}</p>;
  return <div className="kc-list">{rows.map((b) => <div key={b.id} className="kc-item">
    <Dot run={b} />
    <span className="kc-item-t">{TARGET_LABEL[b.target ?? ""] ?? "?"} · {b.label} <span className="ry-faint">r{b.id}</span></span>
    <span className="ry-faint">{b.validated ? t("Bench-tested · ", "검증 기록 있음 · ") : ""}{ago(b.at)}</span>
    {b.conclusion === "success" && <a className="ry-text" href={`/api/admin/builds/${b.id}/download?file=uf2`} title={t("Copy to the keyboard's drive", "키보드 드라이브에 복사")}>{t("USB file", "USB용 파일")}</a>}
    {b.conclusion === "success" && b.target?.startsWith("bt60") && <a className="ry-text" href={`/api/admin/builds/${b.id}/download?file=ble`} title={t("For the nRF Device Firmware Update app", "nRF Device Firmware Update 앱용")}>{t("Bluetooth file", "블루투스용 파일")}</a>}
    {b.conclusion === "success" && <button className="ry-text" onClick={() => go("test", b.id)}>{t("Test", "검증")}</button>}
    <a className="ry-text" href={b.url} target="_blank" rel="noreferrer">{t("Log", "로그")}</a>
  </div>)}</div>;
}

const FIELDS = [
  { id: "idle_timeout_s", min: 10, max: 3600, def: 30 },
  { id: "sleep_min", min: 0, max: 1440, def: 15 },
  { id: "debounce_press_ms", min: 1, max: 30, def: 5 },
  { id: "debounce_release_ms", min: 1, max: 30, def: 5 },
] as const;
const fieldText = (id: (typeof FIELDS)[number]["id"]) => ({
  idle_timeout_s: { label: t("Idle after", "유휴 판단"), unit: t("s", "초"), hint: t("No input for this long counts as idle (when lights turn off).", "이 시간 동안 입력이 없으면 '유휴' (조명 자동 끄기 기준)") },
  sleep_min: { label: t("Default deep sleep", "깊은 절전 기본값"), unit: t("min", "분"), hint: t("The first-boot value; users can change it in keyboard settings. 0 = off", "처음 켤 때의 값. 사용자가 키보드 설정에서 바꿀 수 있어요. 0 = 끔") },
  debounce_press_ms: { label: t("Press debounce", "누름 디바운스"), unit: "ms", hint: t("Raise it if keys chatter.", "채터링이 있으면 올리세요") },
  debounce_release_ms: { label: t("Release debounce", "뗌 디바운스"), unit: "ms", hint: "" },
})[id];

function Build({ onError, go }: { onError: (e: unknown) => void; go: (to: "test", id?: number) => void }) {
  const [target, setTarget] = useState("bt60");
  const [label, setLabel] = useState("");
  const [vals, setVals] = useState<{ [k: string]: number }>(() => Object.fromEntries(FIELDS.map((f) => [f.id, f.def])));
  const [tx, setTx] = useState("default");
  // Each keyboard keeps its own Bluetooth name; switching boards never carries the previous one over.
  const [names, setNames] = useState<{ [target: string]: string }>({ bt60: "Cheeto", "bt60-oreo": "Oreo", ryong60: "" });
  const kbName = names[target] ?? "";
  const setKbName = (v: string) => setNames((n) => ({ ...n, [target]: v }));
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const list = useLoad<{ builds: BuildRow[] }>("/builds", onError);
  useEffect(() => {
    if (!list.data?.builds.some((b) => b.status !== "completed")) return;
    const timer = setTimeout(list.reload, 15000);
    return () => clearTimeout(timer);
  }, [list.data, list.reload]);
  const start = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setStarted(null);
    try {
      const r = await api<{ id: number | null; url?: string }>("/builds", { method: "POST", body: JSON.stringify({ target, label, ...vals, tx_power: tx, keyboard_name: kbName }) });
      setStarted(r.id ? t("Build r{id} started. It usually takes 5–10 minutes.", "빌드 r{id}를 시작했어요. 보통 5–10분 걸려요.", { id: r.id })
        : t("Build requested. It will appear in the list shortly.", "빌드를 요청했어요. 목록에 곧 나타나요."));
      setTimeout(list.reload, 1500);
    } catch (err) { onError(err); } finally { setBusy(false); }
  };
  return <>
    <Section title={t("New firmware build", "새 펌웨어 빌드")}>
      <form className="ry-card kc-form" onSubmit={start}>
        <div className="kc-field"><span className="ry-label">{t("Board", "보드")}</span>
          <div className="kc-seg" role="radiogroup" aria-label={t("Board", "보드")}>
            {Object.entries(TARGET_LABEL).map(([id, l]) => <button type="button" key={id} role="radio" aria-checked={target === id} onClick={() => setTarget(id)}>{l}</button>)}
          </div>
          {target === "ryong60" && <p className="ry-faint">{t("The physical Ryong60 board isn't verified yet. It builds, but can't be released until it has a bench-test record on real hardware.", "Ryong60 실물 보드는 아직 검증 전이에요. 빌드는 되지만, 실물에서 검증 기록을 남기기 전에는 배포할 수 없어요.")}</p>}
        </div>
        <label className="kc-field"><span className="ry-label">{t("Name", "이름")}</span>
          <input type="text" maxLength={40} placeholder={t("e.g. sleep 10 min test", "예: 절전 10분 테스트")} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="kc-grid">
          {FIELDS.map((f) => ({ ...f, ...fieldText(f.id) })).map((f) => <label key={f.id} className="kc-field"><span className="ry-label">{f.label}</span>
            <span className="kc-num"><input type="number" min={f.min} max={f.max} value={vals[f.id]} required
              onChange={(e) => setVals({ ...vals, [f.id]: Number(e.target.value) })} /><span className="ry-faint">{f.unit}</span></span>
            {f.hint && <span className="ry-faint">{f.hint}</span>}</label>)}
          <label className="kc-field"><span className="ry-label">{t("Bluetooth name", "Bluetooth 이름")}</span>
            <input type="text" maxLength={16} placeholder={target === "ryong60" ? t("Empty = Ryong60", "비우면 Ryong60") : t("Empty = BT60 V2 (e.g. Cheeto, Oreo)", "비우면 BT60 V2 (예: Cheeto, Oreo)")} value={kbName}
              onChange={(e) => setKbName(e.target.value)} pattern="[A-Za-z0-9][A-Za-z0-9 _\-]{0,15}" />
            <span className="ry-faint">{t("The name computers and phones show. Up to 16 English letters or digits (e.g. Cheeto)", "컴퓨터·폰에 보이는 이름. 영문·숫자 16자 (예: Cheeto)")}</span></label>
          <label className="kc-field"><span className="ry-label">{t("Bluetooth signal strength", "Bluetooth 신호 세기")}</span>
            <select value={tx} onChange={(e) => setTx(e.target.value)}>
              <option value="default">{t("Default (0 dBm)", "기본 (0 dBm)")}</option><option value="plus4">{t("Strong (+4 dBm)", "강하게 (+4 dBm)")}</option><option value="plus8">{t("Strongest (+8 dBm)", "가장 강하게 (+8 dBm)")}</option>
            </select><span className="ry-faint">{t("Reaches farther but uses more battery", "멀리 닿지만 배터리를 더 써요")}</span></label>
        </div>
        <p className="ry-faint">{t("Settings the keyboard can change on its own, like lights and sleep, aren't here. Users change them in keysbeta's settings screen.", "조명·절전처럼 키보드에서 바로 바꿀 수 있는 설정은 여기 없어요. 사용자가 keysbeta 설정 화면에서 바꿔요.")}</p>
        <div className="kc-actions"><button className="ry-primary" disabled={busy}>{busy ? t("Starting…", "시작하는 중…") : t("Start build", "빌드 시작")}</button></div>
        {started && <p className="ry-note" role="status">{started}</p>}
      </form>
    </Section>
    <Section title={t("Builds", "빌드 목록")} action={<button className="ry-text" onClick={list.reload} disabled={list.loading}>{list.loading ? t("Loading…", "불러오는 중…") : t("Refresh", "새로고침")}</button>}>
      <BuildList rows={list.data?.builds ?? []} go={go} />
      <p className="ry-faint">{t("Build files are kept on GitHub for 30 days and can only be downloaded here. Nothing reaches anyone before it's bench-tested.", "빌드 파일은 GitHub에 30일 보관되고, 이 화면에서만 받을 수 있어요. 검증 전에는 누구에게도 배포되지 않아요.")}</p>
    </Section>
  </>;
}

function BuildPicker({ focus, setFocus, onError, filter }: { focus: number | null; setFocus: (n: number) => void; onError: (e: unknown) => void; filter?: (b: BuildRow) => boolean }) {
  const { data } = useLoad<{ builds: BuildRow[] }>("/builds", onError);
  const rows = (data?.builds ?? []).filter((b) => b.conclusion === "success").filter(filter ?? (() => true));
  useEffect(() => { if (!focus && rows[0]) setFocus(rows[0].id); }, [rows, focus, setFocus]);
  return <label className="kc-field"><span className="ry-label">{t("Build", "빌드")}</span>
    <select value={focus ?? ""} onChange={(e) => setFocus(Number(e.target.value))}>
      {!rows.length && <option value="">{t("No successful builds", "성공한 빌드가 없어요")}</option>}
      {rows.map((b) => <option key={b.id} value={b.id}>r{b.id} · {TARGET_LABEL[b.target ?? ""]} · {b.label} {b.validated ? t("· tested", "· 기록 있음") : ""}</option>)}
    </select></label>;
}

function Test({ onError, focus, setFocus, go }: { onError: (e: unknown) => void; focus: number | null; setFocus: (n: number) => void; go: (to: "release", id?: number) => void }) {
  const detail = useLoad<Detail>(focus ? `/builds/${focus}` : null, onError, [focus]);
  const d = detail.data;
  const [items, setItems] = useState<{ [id: string]: ItemState }>({});
  const [board, setBoard] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setItems(d?.record?.items ?? {}); setBoard(d?.record?.tested_board ?? d?.target ?? ""); setNotes(d?.record?.notes ?? "");
  }, [d]);
  useEffect(() => setSaved(null), [focus]);
  const preview = useMemo(() => evaluate(items), [items]);
  const save = async () => {
    if (!d) return;
    setBusy(true); setSaved(null);
    try {
      await api(`/validation/${d.id}`, { method: "PUT", body: JSON.stringify({ tested_board: board, items, notes }) });
      setSaved(t("Saved. The record is on GitHub (firmware-registry).", "저장했어요. GitHub(firmware-registry)에 기록이 남았어요."));
      detail.reload();
    } catch (e) { onError(e); } finally { setBusy(false); }
  };
  return <>
    <Section title={t("Bench-test record", "실기 검증 기록")}>
      <div className="ry-card kc-form">
        <BuildPicker focus={focus} setFocus={setFocus} onError={onError} />
        {d && <>
          <div className="kc-kv">
            <span>{t("Target", "대상")}</span><b>{TARGET_LABEL[d.target]}</b>
            <span>{t("File", "파일")}</span><span>{d.artifact ? <><code className="kc-hash" title={d.artifact.uf2_sha256}>SHA-256 {d.artifact.uf2_sha256.slice(0, 16)}…</code>
              {d.artifact.expired ? <span className="ry-danger"> {t("Expired", "보관 기간 지남")}</span> : <><a className="ry-text" href={`/api/admin/builds/${d.id}/download?file=uf2`}>{t("USB file", "USB용 파일")}</a>
                {d.target.startsWith("bt60") && <a className="ry-text" href={`/api/admin/builds/${d.id}/download?file=ble`}>{t("Bluetooth file", "블루투스용 파일")}</a>}</>}</> : t("None", "없음")}</span>
            <span>{t("Code", "코드")}</span><span><code>{d.sha.slice(0, 7)}</code> · {ago(d.at)}</span>
          </div>
          <p className="ry-faint">{t("Flash this file onto the keyboard yourself and check each item below. The record applies only to this file (SHA-256).", "이 파일을 키보드에 직접 올려 아래 항목을 하나씩 확인하세요. 기록은 이 파일(SHA-256)에만 적용돼요.")}</p>
          <label className="kc-field"><span className="ry-label">{t("Board tested", "테스트한 보드")}</span>
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              {checklist.boards.map((b) => <option key={b.id} value={b.id}>{labelOf(b)}</option>)}
            </select></label>
          <ol className="kc-checks">
            {checklist.items.map((i) => <li key={i.id} className={"kc-check is-" + (items[i.id] ?? "none")}>
              <span className="kc-check-t">{labelOf(i)}{!i.required && <span className="ry-faint">{(i as { stable?: boolean }).stable ? t(" · needed for stable", " · 정식 배포 때 필요") : t(" · optional", " · 선택")}</span>}</span>
              <span className="kc-seg kc-seg-sm" role="radiogroup" aria-label={labelOf(i)}>
                {(["pass", "fail", "skip"] as ItemState[]).map((s) => <button key={s} type="button" role="radio" aria-checked={items[i.id] === s}
                  onClick={() => setItems({ ...items, [i.id]: s })}>{{ pass: t("Pass", "통과"), fail: t("Fail", "실패"), skip: t("Skip", "안 함") }[s]}</button>)}
              </span>
            </li>)}
          </ol>
          <label className="kc-field"><span className="ry-label">{t("Notes", "메모")}</span>
            <textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Test setup, anything odd…", "테스트 환경, 이상한 점…")} /></label>
          <div className="kc-actions">
            <span className={"kc-verdict is-" + preview.result}>{{ pass: preview.stable_ready ? t("Ready for stable", "정식 배포 가능") : t("Ready for beta", "베타 배포 가능"), fail: t("Some items failed", "실패 항목 있음"), incomplete: t("Items left to check", "아직 확인할 항목이 남았어요") }[preview.result]}</span>
            <button className="ry-primary" onClick={save} disabled={busy || !d.artifact}>{busy ? t("Saving…", "저장 중…") : t("Save record", "검증 기록 저장")}</button>
          </div>
          {saved && <p className="ry-note" role="status">{saved} {preview.result === "pass" && <button className="ry-text" onClick={() => go("release", d.id)}>{t("Go to release", "배포하러 가기")}</button>}</p>}
        </>}
      </div>
    </Section>
  </>;
}

function Release({ onError, focus, setFocus }: { onError: (e: unknown) => void; focus: number | null; setFocus: (n: number) => void }) {
  const overview = useLoad<{ channels: Channels }>("/overview", onError);
  const detail = useLoad<Detail>(focus ? `/builds/${focus}` : null, onError, [focus]);
  const [confirm, setConfirm] = useState<"beta" | "stable" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = detail.data;
  const go = async (channel: "beta" | "stable") => {
    if (!d) return;
    setBusy(true); setMsg(null);
    try {
      await api("/releases", { method: "POST", body: JSON.stringify({ run_id: d.id, channel }) });
      setMsg(channel === "beta" ? t("Beta release started. It shows up under 'Released firmware' in 1–2 minutes.", "베타 배포를 시작했어요. 1–2분 뒤 '배포 중인 펌웨어'에 나타나요.")
        : t("Stable release started. It shows up under 'Released firmware' in 1–2 minutes.", "정식 배포를 시작했어요. 1–2분 뒤 '배포 중인 펌웨어'에 나타나요."));
      setConfirm(null);
      setTimeout(() => { overview.reload(); detail.reload(); }, 60000);
    } catch (e) {
      if (e instanceof ApiError && e.blockers) setMsg(t("Can't release: ", "배포할 수 없어요: ") + e.blockers.join(" "));
      else onError(e);
    } finally { setBusy(false); }
  };
  return <>
    <Section title={t("Released firmware", "배포 중인 펌웨어")} action={<button className="ry-text" onClick={overview.reload}>{t("Refresh", "새로고침")}</button>}>
      <ChannelCards channels={overview.data?.channels ?? {}} />
    </Section>
    <Section title={t("Release a build", "빌드 배포")}>
      <div className="ry-card kc-form">
        <BuildPicker focus={focus} setFocus={setFocus} onError={onError} filter={(b) => !!b.validated} />
        {d && (["beta", "stable"] as const).map((ch) => {
          const why = d.blockers[ch];
          const done = d.released.includes(ch);
          return <div key={ch} className="kc-release">
            <div><b>{ch === "beta" ? t("Beta channel", "베타 채널") : t("Stable channel", "정식 채널")}</b>
              <span className="ry-faint"> {ch === "beta" ? t("· for early testers", "· 미리 써 보는 사람용") : t("· for all users (only builds that went through beta)", "· 모든 사용자용 (베타를 거친 빌드만)")}</span></div>
            {done ? <span className="kc-verdict is-pass">{t("Released", "배포됨")}</span> : why.length ? <ul className="kc-why">{why.map((w) => <li key={w}>{w}</li>)}</ul>
              : confirm === ch ? <div className="kc-actions">
                <span>{ch === "beta" ? t("Release r{id} ({board}) to beta?", "r{id}({board})를 베타로 배포할까요?", { id: d.id, board: TARGET_LABEL[d.target] })
                  : t("Release r{id} ({board}) to stable?", "r{id}({board})를 정식으로 배포할까요?", { id: d.id, board: TARGET_LABEL[d.target] })}</span>
                <button className="ry-text" onClick={() => setConfirm(null)}>{t("Cancel", "취소")}</button>
                <button className="ry-primary" disabled={busy} onClick={() => go(ch)}>{busy ? t("Requesting…", "요청 중…") : t("Release", "배포하기")}</button>
              </div> : <button className="ry-outline" onClick={() => setConfirm(ch)}>{ch === "beta" ? t("Release to beta", "베타로 배포") : t("Release to stable", "정식으로 배포")}</button>}
          </div>;
        })}
        {msg && <p className="ry-note" role="status">{msg}</p>}
        <p className="ry-faint">{t("Releasing creates a GitHub Release and a channel record. There is no package signing yet, so it isn't offered as a web update to users.", "배포하면 GitHub Release와 채널 기록이 생겨요. 아직 패키지 서명 체계가 없어서, 사용자 웹 업데이트로는 제공되지 않아요.")}</p>
      </div>
    </Section>
  </>;
}
