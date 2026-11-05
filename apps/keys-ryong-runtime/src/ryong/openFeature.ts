// "Edit this key's tap dance / tap·hold": from the keymap picker to the header tab's editor for that key.
/** for "macro", layer carries the macro slot */
export type FeatureTarget = { kind: "dance" | "hold" | "macro"; layer: number; pos: number };
let pending: FeatureTarget | null = null;
export function openFeature(target: FeatureTarget) {
  pending = target;
  window.dispatchEvent(new CustomEvent<FeatureTarget>("ryong:open-feature", { detail: target }));
}
/** The editor takes the request once (also when it mounts after the event). */
export function takeFeature(kind: FeatureTarget["kind"]): FeatureTarget | null {
  if (!pending || pending.kind !== kind) return null;
  const p = pending; pending = null; return p;
}
