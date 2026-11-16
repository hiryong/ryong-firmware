// Release rules shared by the admin API (for the screen) and mirrored in
// scripts/firmware_release_gate.py (which the release workflow enforces — the API check is only advisory).
// The bench-test record (evaluate/sanitize) is kept for the owner's notes; releasing no longer needs it.
import checklist from "./checklist.json";
import { fail, Lang } from "./lang";

export type ItemState = "pass" | "fail" | "skip";
export type Channel = "beta" | "stable";
export interface ValidationRecord {
  version: 1;
  run_id: number;
  target: string;
  tested_board: string;
  uf2_sha256: string;
  tester: string;
  tested_at: string;
  items: { [id: string]: ItemState };
  notes: string;
  result: "pass" | "fail" | "incomplete";
  stable_ready: boolean;
}

export const ITEMS = checklist.items;
export const BOARDS = checklist.boards.map((b) => b.id);

export function evaluate(items: { [id: string]: ItemState }) {
  const any = (pred: (s: ItemState | undefined) => boolean, list = ITEMS) => list.some((i) => pred(items[i.id]));
  const required = ITEMS.filter((i) => i.required);
  const stable = ITEMS.filter((i) => i.required || i.stable);
  const failed = any((s) => s === "fail");
  const result: ValidationRecord["result"] = failed ? "fail" : required.every((i) => items[i.id] === "pass") ? "pass" : "incomplete";
  return { result, stable_ready: result === "pass" && stable.every((i) => items[i.id] === "pass") };
}

/** Cleans what the browser sent. Throws a message for the person on bad input. */
export function sanitize(body: unknown, build: { run_id: number; target: string; uf2_sha256: string }, tester: string, now = new Date()): ValidationRecord {
  const b = (body ?? {}) as { [k: string]: unknown };
  const items: { [id: string]: ItemState } = {};
  const given = (b.items ?? {}) as { [k: string]: unknown };
  for (const i of ITEMS) {
    const v = given[i.id];
    if (v === "pass" || v === "fail" || v === "skip") items[i.id] = v;
  }
  const board = String(b.tested_board ?? "");
  if (!BOARDS.includes(board)) fail("Choose the board you tested on.", "테스트한 보드를 골라 주세요.");
  const notes = String(b.notes ?? "").slice(0, 2000);
  return { version: 1, run_id: build.run_id, target: build.target, tested_board: board, uf2_sha256: build.uf2_sha256,
    tester, tested_at: now.toISOString(), items, notes, ...evaluate(items) };
}

/** Owner's decision 2026-11-16: a bench-test record is optional; only the board check remains
 *  (a successful build with its file info, a known board, once per channel). The record is still accepted
 *  so the screen can show it, but it decides nothing. */
export function releaseBlockers(channel: Channel, build: { conclusion: string; target: string; uf2_sha256?: string; branch?: string; release_branch?: string } | null,
  _record: ValidationRecord | null, released: Channel[], lang: Lang = "ko"): string[] {
  const why: string[] = [];
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  if (!build) return [t("Build not found.", "빌드를 찾을 수 없어요.")];
  if (build.conclusion !== "success") why.push(t("The build did not succeed.", "빌드가 성공하지 않았어요."));
  if (!build.uf2_sha256) why.push(t("Couldn't read the build file info (build-info).", "빌드 파일 정보(build-info)를 읽지 못했어요."));
  if (build.branch && build.release_branch && build.branch !== build.release_branch)
    why.push(t("Only builds of the work branch can be released. Build it again from this page.", "작업 브랜치에서 만든 빌드만 배포할 수 있어요. 이 화면에서 다시 빌드하세요."));
  if (build.conclusion === "success" && !BOARDS.includes(build.target)) why.push(t("Unknown target board.", "어느 보드용인지 알 수 없어요."));
  if (released.includes(channel)) why.push(t("Already released to this channel.", "이미 이 채널에 배포했어요."));
  return why;
}
