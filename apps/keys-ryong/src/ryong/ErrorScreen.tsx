import { Component, ReactNode } from "react";
import { t } from "./i18n";
import { RyongMark } from "./RyongMark";

// If the page breaks while starting, show why (instead of a blank screen), with a way out.
export class ErrorScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("keys.ryong.com crashed", error);
  }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const reset = () => {
      try {
        Object.keys(localStorage).filter((k) => k.startsWith("ryong.") || k === "keymapScale").forEach((k) => localStorage.removeItem(k));
        sessionStorage.clear();
      } catch {
        /* no storage */
      }
      location.reload();
    };
    const details = [e.message, ...(e.stack?.split("\n").slice(1, 6) ?? [])].join("\n");
    const copy = () => navigator.clipboard?.writeText(details).catch(() => {});
    return (
      <main className="ry-crash">
        <RyongMark size={28} />
        <h1>
          <span className="ry-dot is-bad" aria-hidden="true" />
          {t("Something went wrong", "문제가 생겼어요")}
        </h1>
        <p>{t("The page ran into an error. Reloading usually fixes it; your keyboard and its keymap are not affected.", "페이지에서 오류가 났어요. 대부분 새로고침하면 돼요. 키보드와 키맵에는 영향이 없어요.")}</p>
        <div className="ry-crash-actions">
          <button className="ry-primary" onClick={() => location.reload()}>
            {t("Reload", "새로고침")}
          </button>
          <button className="ry-outline" onClick={reset}>
            {t("Reset saved settings", "저장값 초기화")}
          </button>
        </div>
        <p className="ry-crash-hint">{t("If it keeps happening, resetting clears this site's settings in this browser (not your keyboard).", "계속 반복되면 초기화해 보세요. 이 브라우저에 저장된 사이트 설정만 지워져요. 키보드는 그대로예요.")}</p>
        <details className="ry-crash-details">
          <summary>{t("Details", "자세히")}</summary>
          <pre>{details}</pre>
          <button className="ry-text" onClick={copy}>
            {t("Copy", "복사")}
          </button>
        </details>
      </main>
    );
  }
}
