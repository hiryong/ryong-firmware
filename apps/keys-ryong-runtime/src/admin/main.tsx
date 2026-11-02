import React from "react";
import ReactDOM from "react-dom/client";
import "../ryong/ryong.css";
import "./admin.css";
import { AdminApp } from "./AdminApp";

/** Never a black screen: show what broke and a way back. */
class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="kc-shell kc-login"><div className="ry-card kc-login-card">
      <b>관리 화면을 그리다 문제가 생겼어요.</b>
      <code className="kc-hash" style={{ whiteSpace: "pre-wrap" }}>{String(this.state.error?.message || this.state.error)}</code>
      <button className="ry-primary" onClick={() => location.reload()}>다시 불러오기</button>
      <button className="ry-text" onClick={() => fetch("/api/admin/logout", { method: "POST", headers: { "X-Ryong-Admin": "1" } }).finally(() => location.reload())}>로그아웃하고 다시 시작</button>
    </div></div>;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary><AdminApp /></Boundary>
  </React.StrictMode>
);
