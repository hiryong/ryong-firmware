import { useContext } from "react";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { RuntimeBindingsContext, namedRuntimeBindings } from "./bindings";
import { t } from "../i18n";
export function RuntimeBindingPicker({ binding, onChange }: {
  binding: BehaviorBinding; onChange: (binding: BehaviorBinding) => void;
}) {
  const choices = namedRuntimeBindings(useContext(RuntimeBindingsContext));
  if (!choices.length) return null;
  const selected = choices.find(c => c.binding.behaviorId === binding.behaviorId && c.binding.param1 === binding.param1 && binding.param2 === 0)?.key ?? "";
  return <label className="ry-gap">{t("Saved dynamic action", "저장된 동적 동작")}
    <select aria-label={t("Assign saved dynamic action", "저장된 동적 동작 지정")} value={selected}
      onChange={event => { const choice = choices.find(c => c.key === event.target.value); if (choice) onChange({ ...choice.binding }); }}>
      <option value="">{t("Choose macro or Tap Dance", "매크로 또는 탭댄스 선택")}</option>
      {choices.map(choice => <option key={choice.key} value={choice.key}>
        {choice.kind === "macro" ? t("Macro", "매크로") : t("Tap Dance", "탭댄스")} · {choice.label}
      </option>)}
    </select>
  </label>;
}
