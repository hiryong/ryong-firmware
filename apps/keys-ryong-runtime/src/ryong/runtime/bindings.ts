import { createContext } from "react";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { RuntimeView } from "./modelBridge";
export const RuntimeBindingsContext = createContext<RuntimeView | null>(null);
export type NamedRuntimeBinding = { key: string; label: string; kind: "macro" | "dance"; binding: BehaviorBinding };
/** Only durable entries read back from this connection; never guess IDs from names. */
export function namedRuntimeBindings(view: RuntimeView | null): NamedRuntimeBinding[] {
  if (!view) return [];
  const choices: NamedRuntimeBinding[] = [];
  if (view.catalog.ref) for (const macro of view.snapshot.macros) {
    choices.push({ key: "macro:" + macro.slot, label: macro.name, kind: "macro",
      binding: { behaviorId: view.catalog.ref, param1: macro.slot, param2: 0 } });
  }
  if (view.catalog.rtd) for (const dance of view.snapshot.advanced?.dances ?? []) {
    choices.push({ key: "dance:" + dance.index, label: dance.name, kind: "dance",
      binding: { behaviorId: view.catalog.rtd, param1: dance.index, param2: 0 } });
  }
  return choices;
}
