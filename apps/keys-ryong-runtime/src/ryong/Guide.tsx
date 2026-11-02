import type { ReactNode } from "react";
import { Laptop, Monitor } from "lucide-react";
import type { HubTab } from "./Hub";
import { inApp, platform, useAppRelease } from "./app";
import { L, t } from "./i18n";

const Link = ({ to, onTab, children }: { to: HubTab; onTab: (t: HubTab) => void; children: ReactNode }) => (
  <button className="ry-link" onClick={() => onTab(to)}>
    {children}
  </button>
);

export const Guide = ({ onTab }: { onTab: (t: HubTab) => void }) => {
  const fw = <Link to="firmware" onTab={onTab}>{t("Firmware", "펌웨어")}</Link>;
  const cm = <Link to="firmware" onTab={onTab}>{t("Firmware → your keyboard → Edit", "펌웨어 → 내 키보드 → 편집")}</Link>;
  const bk = <Link to="backup" onTab={onTab}>{t("Backup", "백업")}</Link>;
  return (
    <>
      <div className="ry-sec">
        <h1 className="ry-h1">{t("Guide", "가이드")}</h1>
        <p className="ry-lead">
          {t(
            "Most of the time you only need the editor: plug in, change keys, press Save. The rest is here for when you need it.",
            "대부분은 편집기만 있으면 돼요. 연결하고, 키를 바꾸고, 저장을 누르세요. 나머지는 필요할 때 여기 있어요."
          )}
        </p>
      </div>

      <div className="ry-sec">
        <h2 className="ry-h2">{t("Connect", "연결")}</h2>
        <ol className="ry-steps">
          <li>
            <span>{t("Open this page in Chrome or Edge. Safari can't talk to keyboards.", "이 페이지를 Chrome이나 Edge에서 여세요. Safari는 키보드와 연결할 수 없어요.")}</span>
          </li>
          <li>
            <span>
              {t("Plug the keyboard in by USB and choose USB.", "키보드를 USB로 연결하고 USB를 고르세요.")}{" "}
              {inApp
                ? t("Or choose BLE to edit over Bluetooth.", "블루투스로 편집하려면 BLE를 고르세요.")
                : t("For Bluetooth on Mac or Windows, use the desktop app below.", "맥이나 윈도우에서 블루투스로 편집하려면 아래 데스크톱 앱을 쓰세요.")}
            </span>
          </li>
          <li>
            <span>
              {t(
                "If asked to unlock, press the keyboard's unlock key. The unlock screen shows it when this site knows the keyboard.",
                "잠금을 풀라고 하면 키보드의 잠금 해제 키를 누르세요. 이 사이트가 아는 키보드라면 잠금 화면에 그 키가 나와요."
              )}
            </span>
          </li>
          <li>
            <span>
              {t(
                "Change keys, then press Save at the top. Without Save, changes are gone when the keyboard restarts.",
                "키를 바꾼 뒤 위의 저장을 누르세요. 저장하지 않으면 키보드를 다시 켤 때 사라져요."
              )}
            </span>
          </li>
        </ol>
      </div>

      {!inApp && <DesktopApp />}

      {import.meta.env.VITE_RYONG_RUNTIME === "1" ? <RuntimeGuide /> : <>
      <div className="ry-sec">
        <h2 className="ry-h2">{t("Three things to tell apart", "구분해야 할 세 가지")}</h2>
        {L(
          <>
            <p className="ry-lead">
              <b>Firmware</b> is the program inside the keyboard. It decides which features exist (Bluetooth, backlight,
              combos, macros…) and which layouts (ANSI, HHKB…) you can pick. Updating it means copying a new .uf2 file onto
              the keyboard — see {fw}.
            </p>
            <p className="ry-lead">
              <b>The keymap</b> is what each key does. The firmware brings a default one; what you change in the editor is
              stored on the keyboard on top of it.
            </p>
            <p className="ry-lead">
              <b>The editor</b> puts what the firmware already has onto keys, live. New combos, macros and tap dances have to
              be added to the firmware itself — {cm} does that for keyboards whose firmware is built on GitHub.
            </p>
          </>,
          <>
            <p className="ry-lead">
              <b>펌웨어</b>는 키보드 안의 프로그램이에요. 어떤 기능(블루투스, 백라이트, 콤보, 매크로…)과 어떤 배열(ANSI,
              HHKB…)을 쓸 수 있는지 정해요. 업데이트는 새 .uf2 파일을 키보드에 복사하는 거예요 — {fw}를 보세요.
            </p>
            <p className="ry-lead">
              <b>키맵</b>은 각 키가 하는 일이에요. 펌웨어에 기본 키맵이 들어 있고, 편집기에서 바꾼 내용은 그 위에 덮어
              키보드에 저장돼요.
            </p>
            <p className="ry-lead">
              <b>편집기</b>는 펌웨어에 이미 있는 기능을 키에 바로 배치해요. 새 콤보, 매크로, 탭댄스는 펌웨어 자체에
              넣어야 해요 — GitHub에서 펌웨어를 빌드하는 키보드라면 {cm}에서 할 수 있어요.
            </p>
          </>
        )}
      </div>

      <div className="ry-sec">
        <h2 className="ry-h2">{t("What to change where", "무엇을 어디서 바꾸나")}</h2>
        <table className="ry-table">
          <thead>
            <tr>
              <th>{t("To…", "하려는 일")}</th>
              <th>{t("Use", "쓰는 곳")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t("Change a key", "키 바꾸기")}</td>
              <td>{t("The editor → Save. No firmware update.", "편집기 → 저장. 펌웨어 업데이트 필요 없어요.")}</td>
            </tr>
            <tr>
              <td>{t("Add, rename, reorder layers", "레이어 추가·이름 변경·순서 변경")}</td>
              <td>{t("The editor", "편집기")}</td>
            </tr>
            <tr>
              <td>{t("Switch ANSI ↔ HHKB", "ANSI ↔ HHKB 바꾸기")}</td>
              <td>{t("The editor's Layout menu, if the firmware includes that layout", "편집기의 배열 메뉴 (펌웨어에 그 배열이 있을 때)")}</td>
            </tr>
            <tr>
              <td>{t("Update firmware", "펌웨어 업데이트")}</td>
              <td>
                {fw} — {t("your keys are saved first and offered back afterwards", "키를 먼저 저장해 두고, 끝나면 되돌릴지 물어봐요")}
              </td>
            </tr>
            <tr>
              <td>{t("Make a combo, macro or tap dance", "콤보·매크로·탭댄스 만들기")}</td>
              <td>
                {cm}{" "}
                {t(
                  "(sign in with GitHub) → update firmware → put it on a key in the editor",
                  "(GitHub 로그인) → 펌웨어 업데이트 → 편집기에서 키에 배치"
                )}
              </td>
            </tr>
            <tr>
              <td>{t("Undo a reset or a bad update", "초기화나 잘못된 업데이트 되돌리기")}</td>
              <td>{bk}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="ry-sec">
        <h2 className="ry-h2">{t("Good to know", "알아두면 좋아요")}</h2>
        <p className="ry-note">
          {t(
            "A firmware update usually keeps your keys. They can go back to the default after a big firmware change or a “Restore Stock Settings”. This page remembers your keys each time you save, and offers to bring them back when it notices they changed.",
            "펌웨어를 업데이트해도 보통 키는 그대로예요. 큰 펌웨어 변경이나 “기본 설정으로 되돌리기” 뒤에는 기본값으로 돌아갈 수 있어요. 이 페이지는 저장할 때마다 키를 기억해 두고, 바뀐 걸 알아채면 되돌릴지 물어봐요."
          )}
        </p>
        <p className="ry-note">
          {t(
            "Keys changed here don't change the keymap file on GitHub. Once you use the editor, edits to that file's keys only show after “Restore Stock Settings”. Combos and macros are separate and always arrive with the firmware.",
            "여기서 바꾼 키는 GitHub의 키맵 파일을 바꾸지 않아요. 편집기를 한 번 쓰고 나면, 그 파일에서 바꾼 키는 “기본 설정으로 되돌리기” 뒤에야 보여요. 콤보와 매크로는 따로라서 항상 펌웨어와 함께 들어가요."
          )}
        </p>
      </div>
      </>}
    </>
  );
};

/** keysbeta: everything is changed on the keyboard itself; firmware is the maker's job. */
const RuntimeGuide = () => (
  <>
    <div className="ry-sec">
      <h2 className="ry-h2">{t("What to change where", "무엇을 어디서 바꾸나")}</h2>
      <table className="ry-table">
        <thead><tr><th>{t("To…", "하려는 일")}</th><th>{t("Use", "쓰는 곳")}</th></tr></thead>
        <tbody>
          <tr><td>{t("Change a key or a layer", "키·레이어 바꾸기")}</td><td>{t("Keymap → Save", "키맵 → 저장")}</td></tr>
          <tr><td>{t("Make a combo, macro or tap dance", "콤보·매크로·탭댄스 만들기")}</td><td>{t("Its tab → Save to keyboard. No firmware update, no sign-in.", "각 탭 → 키보드에 저장. 펌웨어 업데이트도, 로그인도 필요 없어요.")}</td></tr>
          <tr><td>{t("Tap / hold timing", "짧게·길게 누르기 판정")}</td><td>Hold-Tap</td></tr>
          <tr><td>{t("Lights, deep sleep", "조명, 깊은 절전")}</td><td>{t("Keyboard settings", "키보드 설정")}</td></tr>
          <tr><td>{t("Name, switch or remove Bluetooth devices", "Bluetooth 기기 이름·전환·삭제")}</td><td>{t("Bluetooth devices", "Bluetooth 기기")}</td></tr>
          <tr><td>{t("Keep a copy of your keys", "키 설정 보관")}</td><td>{t("Backup", "백업")}</td></tr>
        </tbody>
      </table>
    </div>
    <div className="ry-sec">
      <h2 className="ry-h2">{t("Good to know", "알아두면 좋아요")}</h2>
      <p className="ry-note">{t("Everything here is stored on the keyboard and survives turning it off. Only what the firmware itself contains (for example N-key rollover) is decided by the keyboard maker.",
        "여기서 바꾸는 건 모두 키보드에 저장되고 꺼도 유지돼요. 펌웨어 자체에 들어가는 것(예: N키 롤오버)만 키보드 제작자가 정해요.")}</p>
    </div>
  </>
);

const DesktopApp = () => {
  const r = useAppRelease();
  const first = platform === "windows" ? "windows" : "mac";
  const mac = {
    id: "mac",
    icon: <Laptop />,
    label: t("Download for Mac", "Mac용 다운로드"),
    file: r?.mac,
    sub: t("macOS 11 or later · Apple silicon and Intel", "macOS 11 이상 · Apple 실리콘, Intel"),
  };
  const win = { id: "windows", icon: <Monitor />, label: t("Download for Windows", "Windows용 다운로드"), file: r?.windows, sub: t("Windows 10 or later", "Windows 10 이상") };
  const items = first === "windows" ? [win, mac] : [mac, win];

  return (
    <div className="ry-sec" id="ry-app">
      <h2 className="ry-h2">{t("Desktop app", "데스크톱 앱")}</h2>
      <p className="ry-lead">
        {t(
          "Edit keys over Bluetooth, no cable. The app opens this same site, so everything here works in it and it stays up to date by itself.",
          "케이블 없이 블루투스로 키를 바꿔요. 앱은 이 사이트를 그대로 열어서, 여기 있는 기능이 모두 되고 따로 업데이트할 필요가 없어요."
        )}
      </p>
      {r === undefined ? null : !r ? (
        <p className="ry-note">{t("The first build of the app is on its way. Check back soon.", "앱 첫 빌드를 준비 중이에요. 조금 뒤에 다시 와주세요.")}</p>
      ) : (
        <>
          <div className="ry-gap">
            {items.map((i) =>
              i.file ? (
                <a key={i.id} className={i.id === first ? "ry-primary" : "ry-outline"} href={`/app/${i.file}`} download>
                  {i.icon}
                  {i.label}
                </a>
              ) : null
            )}
          </div>
          <p className="ry-faint" style={{ marginTop: 8 }}>
            {t("Version {v}", "버전 {v}", { v: r.version })} · {items.filter((i) => i.file).map((i) => i.sub).join(" · ")}
          </p>
          <ol className="ry-steps">
            <li>
              <span>
                {L(
                  <>
                    <b>Mac:</b> open the .dmg and drag the app to Applications. The first time, macOS says it can't check the
                    app: open <b>System Settings → Privacy &amp; Security</b>, scroll down and press <b>Open Anyway</b>. Allow
                    Bluetooth when asked.
                  </>,
                  <>
                    <b>Mac:</b> .dmg를 열고 앱을 응용 프로그램 폴더로 옮기세요. 처음 열 때 macOS가 앱을 확인할 수 없다고 하면{" "}
                    <b>시스템 설정 → 개인정보 보호 및 보안</b>에서 아래로 내려 <b>그래도 열기</b>를 누르세요. 블루투스 권한을
                    물으면 허용하세요.
                  </>
                )}
              </span>
            </li>
            <li>
              <span>
                {L(
                  <>
                    <b>Windows:</b> run the installer. If “Windows protected your PC” appears, press <b>More info → Run anyway</b>.
                  </>,
                  <>
                    <b>Windows:</b> 설치 파일을 실행하세요. “Windows의 PC 보호” 창이 뜨면 <b>추가 정보 → 실행</b>을 누르세요.
                  </>
                )}
              </span>
            </li>
            <li>
              <span>
                {L(
                  <>
                    In the app, press <b>BLE</b> and pick the keyboard. It has to be paired with this computer and connected
                    first.
                  </>,
                  <>
                    앱에서 <b>BLE</b>를 누르고 키보드를 고르세요. 키보드가 먼저 이 컴퓨터와 페어링되어 연결돼 있어야 해요.
                  </>
                )}
              </span>
            </li>
          </ol>
        </>
      )}
    </div>
  );
};
