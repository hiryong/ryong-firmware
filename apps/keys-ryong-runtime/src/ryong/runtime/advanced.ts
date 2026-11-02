import * as T from "./proto/runtime_tapdance";
import * as H from "./proto/holdtap";

export type AdvancedPort = {
  dance: (request: T.Request) => Promise<T.Response>;
  hold: (request: H.Request) => Promise<H.Response>;
};
export type AdvancedState = { global: T.GlobalResponse; dances: T.State[]; holds: H.HoldTapInfo[] };
export type AdvancedDesired = { interval: number; dances: { index?: number; name: string; bindings: T.Binding[] }[]; holds: H.HoldTapInfo[] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function checked(r: T.Response) { if (r.error) throw new Error(r.error.message); return r; }
export async function readAdvanced(port: AdvancedPort): Promise<AdvancedState> {
  const global = checked(await port.dance(T.Request.fromPartial({ getGlobal: {} }))).global;
  if (!global || global.apiVersion !== 2 || global.maxEntries > 16 || global.usedEntries > global.maxEntries) throw new Error("Unsupported Tap Dance API/capacity.");
  const dances: T.State[] = [];
  let afterId = 0, hasAfterId = false;
  for (let page = 0; page < 5; page++) {
    const list = checked(await port.dance(T.Request.fromPartial({ list: { afterId, hasAfterId } }))).list;
    if (!list) throw new Error("Missing Tap Dance page.");
    for (const entry of list.entries) {
      if (dances.some(x => x.index === entry.index) || (hasAfterId && entry.index <= afterId)) throw new Error("Invalid Tap Dance pagination.");
      const state = checked(await port.dance(T.Request.fromPartial({ get: { index: entry.index } }))).state;
      if (!state || state.index !== entry.index) throw new Error("Tap Dance changed while reading.");
      dances.push(state);
    }
    if (!list.hasMore) break;
    if (!list.entries.length || list.nextAfterId <= afterId) throw new Error("Non-progressing Tap Dance page.");
    afterId = list.nextAfterId; hasAfterId = true;
  }
  if (dances.length !== global.usedEntries) throw new Error("Tap Dance count changed. Reload.");
  const count = (await port.hold(H.Request.fromPartial({ count: {} }))).count?.count;
  if (count === undefined || count > 8) throw new Error("Unsupported Hold-Tap count.");
  const holds: H.HoldTapInfo[] = [];
  for (let slot = 0; slot < 8; slot++) {
    const item = (await port.hold(H.Request.fromPartial({ get: { slot } }))).get;
    if (item?.found) { if (item.slot !== slot || !item.behaviorId) throw new Error("Unknown Hold-Tap identity."); holds.push(item); }
  }
  if (holds.length !== count) throw new Error("Hold-Tap count changed.");
  return { global, dances, holds };
}
export function validateAdvanced(before: AdvancedState, desired: AdvancedDesired, macroId?: number, danceId?: number) {
  if (!Number.isInteger(desired.interval) || desired.interval < 1 || desired.interval > 2000 || desired.dances.length > before.global.maxEntries) throw new Error("Invalid Tap Dance bounds.");
  const names = new Set<string>(), ids = new Set<number>();
  for (const d of desired.dances) {
    if (!d.name || new TextEncoder().encode(d.name).length > before.global.maxNameLength || names.has(d.name)) throw new Error("Invalid Tap Dance name.");
    names.add(d.name);
    if (d.index !== undefined) {
      if (ids.has(d.index) || !before.dances.some(x => x.index === d.index)) throw new Error("Unconfirmed Tap Dance ID.");
      ids.add(d.index);
    }
    if (d.bindings.length < 1 || d.bindings.length > 3) throw new Error("Tap Dance supports one to three actions.");
    for (const b of d.bindings) {
      if (!b.behaviorId || [b.behaviorId,b.param1,b.param2].some(n => !Number.isInteger(n) || n < 0 || n > 0xffffffff)) throw new Error("Invalid Tap Dance binding.");
      if (b.behaviorId === macroId || b.behaviorId === danceId) throw new Error("Nested macro/dance actions require a separate reference migration; nothing was written.");
    }
  }
  if (desired.holds.length !== before.holds.length || new Set(desired.holds.map(x=>x.slot)).size !== desired.holds.length) throw new Error("Hold-Tap identity changed.");
  for (const h of desired.holds) {
    if (!before.holds.some(x=>x.slot === h.slot && x.behaviorId === h.behaviorId) ||
        ![h.tappingTermMs,h.quickTapMs,h.requirePriorIdleMs,h.flavor].every(Number.isInteger) ||
        h.tappingTermMs < 1 || h.tappingTermMs > 2000 || h.quickTapMs < -1 || h.quickTapMs > 2000 ||
        h.requirePriorIdleMs < -1 || h.requirePriorIdleMs > 2000 || h.flavor < 0 || h.flavor > 3) throw new Error("Invalid Hold-Tap timing.");
  }
}
/** Journal is owned by the outer profile save. No retry after an unknown ACK. */
export async function saveAdvanced(port: AdvancedPort, before: AdvancedState, desired: AdvancedDesired) {
  for (const d of desired.dances) {
    let index = d.index;
    if (index === undefined) {
      const state = checked(await port.dance(T.Request.fromPartial({ create: { name:d.name, persist:false } }))).state;
      if (!state || before.dances.some(x=>x.index===state.index)) throw new Error("Unconfirmed newly allocated Tap Dance ID.");
      index = state.index;
    } else if (before.dances.find(x=>x.index===index)?.name !== d.name) {
      checked(await port.dance(T.Request.fromPartial({ rename: { index, name:d.name, persist:false } })));
    }
    for (let tap = 3; tap > d.bindings.length; tap--) checked(await port.dance(T.Request.fromPartial({ set: { index, tapCount:tap, binding:{behaviorId:0,param1:0,param2:0}, persist:false } })));
    for (let tap = 1; tap <= d.bindings.length; tap++) checked(await port.dance(T.Request.fromPartial({ set: { index, tapCount:tap, binding:d.bindings[tap-1] ?? {behaviorId:0,param1:0,param2:0}, persist:false } })));
  }
  checked(await port.dance(T.Request.fromPartial({ setInterval: { intervalMs:desired.interval, persist:false } })));
  // Remove is staged; IDs are never recycled by the pinned module.
  for (const old of before.dances) if (!desired.dances.some(x=>x.index===old.index)) checked(await port.dance(T.Request.fromPartial({ remove:{index:old.index,persist:false} })));
  checked(await port.dance(T.Request.fromPartial({ save:{} })));
  for (const h of desired.holds) if (!same(h,before.holds.find(x=>x.slot===h.slot))) {
    if (!(await port.hold(H.Request.fromPartial({set:h}))).set?.ok) throw new Error("Hold-Tap persistence failed.");
  }
  const result = await readAdvanced(port);
  if (result.global.intervalMs !== desired.interval || result.dances.length !== desired.dances.length) throw new Error("Advanced configuration readback failed.");
  for (const d of desired.dances) {
    const actual = result.dances.find(x=>x.name===d.name);
    const bindings = [actual?.config?.singleBinding,actual?.config?.doubleBinding,actual?.config?.tripleBinding].filter(x=>x?.behaviorId);
    if (!actual || (d.index !== undefined && d.index !== actual.index) || !same(bindings,d.bindings)) throw new Error("Tap Dance readback differs.");
  }
  if (!same(result.holds,desired.holds)) throw new Error("Hold-Tap readback differs.");
}
