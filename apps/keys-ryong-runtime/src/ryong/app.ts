// The desktop app (ryong-app/) is a small window that opens keys.ryong.com and adds Bluetooth and USB
// through the computer itself. This file is the site's side of it.

import { useEffect, useState } from "react";

export const inApp = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

/** published by .github/workflows/ryong-app.yml next to the downloads */
export interface AppRelease {
  version: string;
  date: string;
  mac?: string;
  windows?: string;
}

let cached: Promise<AppRelease | null> | null = null;
export function useAppRelease() {
  const [r, setR] = useState<AppRelease | null | undefined>(undefined);
  useEffect(() => {
    cached ||= fetch("/app/latest.json", { cache: "no-store" })
      .then((x) => (x.ok && (x.headers.get("Content-Type") || "").includes("json") ? x.json() : null))
      .catch(() => null);
    cached.then(setR);
  }, []);
  return r;
}

export const platform = (() => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /Mac/.test(ua) ? "mac" : /Windows/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : "other";
})();

/**
 * Inside the app, links that would open a new tab (GitHub pages, firmware downloads, docs) open in the
 * computer's own browser instead, where downloads and sign-ins already work.
 */
export function setupAppLinks() {
  if (!inApp) return;
  const open = (url: string) => {
    const tauri = window.__TAURI_INTERNALS__ as { invoke?: (cmd: string, args: unknown) => Promise<unknown> };
    return tauri.invoke?.("ryong_open", { url });
  };
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented) return;
      const url = new URL(a.href, location.href);
      if (url.protocol === "blob:" || url.protocol === "data:") return; // file saves stay in the app
      if (url.origin !== location.origin) {
        e.preventDefault();
        open(url.href);
      } else if (a.target === "_blank") {
        // e.g. a private keyboard's firmware (/api/firmware needs this window's sign-in); the app hands
        // the download it redirects to over to the browser
        e.preventDefault();
        location.assign(url.href);
      }
    },
    true
  );
  const native = window.open.bind(window);
  window.open = (u?: string | URL, t?: string, f?: string) => {
    if (u) {
      const url = new URL(String(u), location.href);
      if (url.origin !== location.origin) {
        open(url.href);
        return null;
      }
    }
    return native(u, t, f);
  };
}
