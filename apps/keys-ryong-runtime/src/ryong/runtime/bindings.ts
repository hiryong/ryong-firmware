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

/** Re-read before assigning a saved action; a stale slot must not select a
 * different macro/dance after another editor changed the device. No writes. */
export async function checkedRuntimeBinding(view:RuntimeView,key:string):Promise<BehaviorBinding>{
  const choice=namedRuntimeBindings(view).find(c=>c.key===key);
  if(!choice)throw Error("Dynamic action is no longer available. Reload settings.");
  const current=await view.session.read();
  const stable=(snapshot:RuntimeView["snapshot"])=>JSON.stringify({macros:snapshot.macros,dances:snapshot.advanced?.dances});
  if(stable(current)!==stable(view.snapshot))throw Error("Dynamic actions changed. Reload before assigning a key.");
  return {...choice.binding};
}
