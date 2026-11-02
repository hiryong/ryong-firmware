import type { ReactNode } from "react";
import { Github } from "lucide-react";
import { chooseRepos, signIn, signInFailed, signOut, useMe } from "./api";
import { t } from "./i18n";

/** Shown only where an extra feature actually needs GitHub — never on arrival. */
export const SignInPrompt = ({ title, children }: { title: string; children: ReactNode }) => {
  const me = useMe();
  if (me.loading) return null;
  return (
    <div className="ry-card">
      <div className="ry-card-t">{title}</div>
      <p className="ry-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
        {children}
      </p>
      {signInFailed && !me.user && <p className="ry-note ry-danger">{t("Sign-in didn't finish. Please try again.", "로그인을 마치지 못했어요. 다시 시도해 주세요.")}</p>}
      {!me.enabled ? (
        <p className="ry-faint">{t("Sign-in isn't set up on this site yet.", "이 사이트는 아직 로그인이 설정되지 않았어요.")}</p>
      ) : !me.user ? (
        <div className="ry-gap">
          <button className="ry-primary" onClick={signIn}>
            <Github /> {t("Sign in with GitHub", "GitHub로 로그인")}
          </button>
        </div>
      ) : (
        <div className="ry-gap">
          <button className="ry-primary" onClick={chooseRepos}>
            <Github /> {t("Choose repositories", "저장소 고르기")}
          </button>
          <span className="ry-faint">{t("Pick your ZMK config repository on GitHub.", "GitHub에서 내 ZMK 설정 저장소를 고르세요.")}</span>
        </div>
      )}
    </div>
  );
};

/** Who's signed in, with the two account actions. */
export const AccountRow = () => {
  const me = useMe();
  if (!me.user) return null;
  return (
    <div className="ry-row ry-ghrow">
      <span className="ry-gap ry-faint">
        <img src={me.user.avatar} alt="" width={20} height={20} style={{ borderRadius: 9999 }} />
        {me.user.login}
      </span>
      <span className="ry-gap">
        <button className="ry-text" onClick={chooseRepos}>
          {t("GitHub access", "GitHub 연결")}
        </button>
        <button className="ry-text" onClick={signOut}>
          {t("Sign out", "로그아웃")}
        </button>
      </span>
    </div>
  );
};

/** Header: only appears once someone is signed in. Nobody is asked to sign in on arrival. */
export const AccountBadge = ({ onOpen }: { onOpen: () => void }) => {
  const me = useMe();
  if (!me.user) return null;
  return (
    <button className="ry-avatar" title={t("Signed in as {u}", "{u}로 로그인됨", { u: me.user.login })} aria-label={t("Signed in as {u}", "{u}로 로그인됨", { u: me.user.login })} onClick={onOpen}>
      <img src={me.user.avatar} alt="" width={24} height={24} />
    </button>
  );
};
