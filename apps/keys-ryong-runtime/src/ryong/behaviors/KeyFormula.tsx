import type { ReactNode } from "react";

// One visual language for "press these → get that" across combos, tap dances and tap·holds:
// the keys you press are dark keycaps, the result is a light keycap (an output, not a key to press).
//   combo:      [1] + [Q]  →  [F1]
//   tap dance:  [Q][Q]     →  [Esc]
//   tap·hold:   [F] hold   →  [Ctrl]

export const Keycap = ({ children, result, size = "md", hold }: { children: ReactNode; result?: boolean; size?: "sm" | "md" | "lg"; hold?: boolean }) =>
  <kbd className={`ry-cap is-${size}${result ? " is-result" : ""}${hold ? " is-hold" : ""}${typeof children === "string" && children.length > 10 ? " is-long" : ""}`}
    title={typeof children === "string" && children.length > 10 ? children : undefined}>{children}</kbd>;

/** a result label as caps: "Ctrl + C" → [Ctrl] + [C]; anything long (a macro, a layer) → one wide cap */
function resultCaps(result: string, size: "sm" | "md" | "lg") {
  const parts = result.split(" + ");
  if (parts.length > 1 && parts.length <= 4 && parts.every((x) => x.length <= 8))
    return parts.map((x, i) => <span key={i} className="ry-fx-part">{i > 0 && <i className="ry-fx-join">+</i>}<Keycap result size={size}>{x}</Keycap></span>);
  return <Keycap result size={size}>{result}</Keycap>;
}

export function Formula({ keys, join = "+", result, size = "md", hold, label }: {
  /** the keys pressed, in order */
  keys: ReactNode[];
  /** "+" (pressed together) or "" (pressed one after another) */
  join?: "+" | "";
  result: string | ReactNode;
  size?: "sm" | "md" | "lg";
  /** which key (index) is held, not tapped */
  hold?: number;
  /** what a screen reader hears instead */
  label?: string;
}) {
  return <span className="ry-fx" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <span className={"ry-fx-in" + (join ? "" : " is-seq")}>
      {keys.map((k, i) => <span key={i} className="ry-fx-part">
        {i > 0 && join && <i className="ry-fx-join">{join}</i>}
        <Keycap size={size} hold={hold === i}>{k}</Keycap>
      </span>)}
    </span>
    <i className="ry-fx-to">→</i>
    <span className="ry-fx-out">{typeof result === "string" ? resultCaps(result, size) : result}</span>
  </span>;
}
