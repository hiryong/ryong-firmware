// Release rules shared by the admin API (for the screen) and mirrored in
// scripts/firmware_release_gate.py (which the release workflow enforces — the API check is only advisory).
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

export function releaseBlockers(channel: Channel, build: { conclusion: string; target: string; uf2_sha256?: string } | null,
  record: ValidationRecord | null, released: Channel[], lang: Lang = "ko"): string[] {
  const why: string[] = [];
  const t = (en: string, ko: string) => (lang === "en" ? en : ko);
  if (!build) return [t("Build not found.", "빌드를 찾을 수 없어요.")];
  if (build.conclusion !== "success") why.push(t("The build did not succeed.", "빌드가 성공하지 않았어요."));
  if (!build.uf2_sha256) why.push(t("Couldn't read the build file info (build-info).", "빌드 파일 정보(build-info)를 읽지 못했어요."));
  if (!record) { why.push(t("No bench-test record yet.", "실기 검증 기록이 없어요.")); return why; }
  if (build.uf2_sha256 && record.uf2_sha256 !== build.uf2_sha256) why.push(t("The tested file differs from this build's file.", "검증한 파일과 이 빌드의 파일이 달라요."));
  if (record.tested_board !== build.target) why.push(t("Not tested on this build's target board.", "이 빌드의 대상 보드에서 검증하지 않았어요."));
  const { result, stable_ready } = evaluate(record.items);
  if (result !== "pass") why.push(result === "fail" ? t("Some test items failed.", "실패한 검증 항목이 있어요.") : t("Not all required test items have passed yet.", "필수 검증 항목이 아직 다 통과하지 않았어요."));
  if (channel === "stable") {
    if (!stable_ready) why.push(t("Items needed for stable (settings kept, battery) have not passed.", "정식 배포에 필요한 항목(설정 유지·배터리)이 통과하지 않았어요."));
    if (!released.includes("beta")) why.push(t("Release to beta first.", "먼저 베타로 배포해야 해요."));
  }
  if (released.includes(channel)) why.push(t("Already released to this channel.", "이미 이 채널에 배포했어요."));
  return why;
}
