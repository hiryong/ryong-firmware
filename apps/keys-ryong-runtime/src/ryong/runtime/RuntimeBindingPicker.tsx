import { useContext, useRef, useState } from "react";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { RuntimeBindingsContext, namedRuntimeBindings, checkedRuntimeBinding } from "./bindings";
import { t } from "../i18n";
export function RuntimeBindingPicker({ binding, onChange }: {
  binding: BehaviorBinding; onChange: (binding: BehaviorBinding) => void;
}) {
  const view=useContext(RuntimeBindingsContext),choices=namedRuntimeBindings(view);
  const current=useRef({binding,view});current.current={binding,view};
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  if (!choices.length) return null;
  const selected = choices.find(c => c.binding.behaviorId === binding.behaviorId && c.binding.param1 === binding.param1 && binding.param2 === 0)?.key ?? "";
  return <div><label className="ry-gap">{t("Saved dynamic action", "저장된 동적 동작")}
    <select aria-label={t("Assign saved dynamic action", "저장된 동적 동작 지정")} value={selected} disabled={busy}
      onChange={async event => {
        if(!view)return;const key=event.target.value;if(!key)return;setBusy(true);setError(null);
        try{const next=await checkedRuntimeBinding(view,key);if(current.current.binding===binding&&current.current.view===view)onChange(next);}
        catch(error){setError(String(error));}finally{setBusy(false);}
      }}>
      <option value="">{t("Choose macro or Tap Dance", "매크로 또는 탭댄스 선택")}</option>
      {choices.map(choice => <option key={choice.key} value={choice.key}>
        {choice.kind === "macro" ? t("Macro", "매크로") : t("Tap Dance", "탭댄스")} · {choice.label}
      </option>)}
    </select>
  </label>{error&&<p role="alert" className="ry-note">{error}</p>}</div>;
}
