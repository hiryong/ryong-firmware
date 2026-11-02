// Small, careful edits to the keyboard's own .keymap file: read layer names, and add one #include line.
// Nothing else in the hand-written keymap is touched.

export const INCLUDE_LINE = '#include "ryong-behaviors.dtsi"';

/** Layer names in order, from `display-name` (or the node name) of each layer in the keymap node. */
export function layerNames(keymap: string): string[] {
  const text = keymap.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const start = text.search(/compatible\s*=\s*"zmk,keymap"/);
  if (start < 0) return [];
  const names: string[] = [];
  let depth = 0;
  // Walk the keymap node: every direct child with `bindings` is a layer.
  const open = text.lastIndexOf("{", start);
  let i = open + 1;
  depth = 1;
  let childStart = -1;
  let childHeader = "";
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === "{") {
      depth++;
      if (depth === 2) {
        childStart = i;
        const before = text.slice(0, i);
        childHeader = before.slice(Math.max(before.lastIndexOf(";"), before.lastIndexOf("}"), open) + 1).trim();
      }
    } else if (ch === "}") {
      if (depth === 2 && childStart >= 0) {
        const body = text.slice(childStart, i);
        if (/\bbindings\s*=/.test(body)) {
          const dn = body.match(/display-name\s*=\s*"([^"]*)"/);
          const node = childHeader.split(":").pop()!.trim();
          names.push(dn ? dn[1] : node);
        }
        childStart = -1;
      }
      depth--;
    }
    i++;
  }
  return names;
}

export const hasInclude = (keymap: string) => keymap.includes(INCLUDE_LINE);

/** Adds the include after the last existing #include (so keys.h etc. are already loaded). */
export function addInclude(keymap: string): string {
  if (hasInclude(keymap)) return keymap;
  const lines = keymap.split("\n");
  let last = -1;
  lines.forEach((l, i) => {
    if (/^\s*#include\b/.test(l)) last = i;
  });
  lines.splice(last + 1, 0, INCLUDE_LINE);
  return lines.join("\n");
}

/** Folder of a path, with trailing slash ("" for repo root). */
export const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");

/**
 * Make an overlay layer the base: where layer `n` has a key (not &trans), base and layer swap that key.
 * BT60 V2 keeps Windows keys on the base and the Mac ones on layer 1 ("os", Fn + Tab), so this turns a
 * Windows keymap into a Mac one with Windows on Fn + Tab, and back. Line breaks are kept.
 */
export function swapBaseWithLayer(keymap: string, n: number): string {
  const m = keymap.replace(/\/\*[\s\S]*?\*\//g, (x) => x.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, (x) => " ".repeat(x.length));
  const start = m.search(/compatible\s*=\s*"zmk,keymap"/);
  if (start < 0) throw new Error("No keymap node found.");
  const spans: [number, number][] = [];
  const re = /bindings\s*=\s*</g;
  re.lastIndex = start;
  for (let r = re.exec(m); r && spans.length <= n; r = re.exec(m)) {
    const s = r.index + r[0].length;
    spans.push([s, m.indexOf(">", s)]);
  }
  if (spans.length <= n) throw new Error(`The keymap has no layer ${n}.`);
  const parse = ([s, e]: [number, number]) =>
    keymap
      .slice(s, e)
      .split("\n")
      .map((line) => {
        const out: string[] = [];
        for (const tok of line.trim().split(/\s+/).filter(Boolean)) {
          if (tok.startsWith("&")) out.push(tok);
          else if (out.length) out[out.length - 1] += " " + tok;
        }
        return { indent: line.match(/^\s*/)![0], keys: out, line };
      });
  const base = parse(spans[0]);
  const layer = parse(spans[n]);
  const flat = (rows: { keys: string[] }[]) => rows.flatMap((r) => r.keys);
  const b = flat(base);
  const l = flat(layer);
  if (b.length !== l.length) throw new Error("Layers have different sizes.");
  const nb = b.map((k, i) => (l[i] !== "&trans" ? l[i] : k));
  const nl = l.map((k, i) => (k !== "&trans" ? b[i] : "&trans"));
  const rebuild = (rows: { indent: string; keys: string[]; line: string }[], keys: string[]) => {
    let i = 0;
    return rows
      .map((r) => {
        const next = r.keys.map(() => keys[i++]);
        // untouched rows keep their original spacing
        return next.every((k, j) => k === r.keys[j]) ? r.line : r.indent + next.join(" ");
      })
      .join("\n");
  };
  // later span first, so the earlier one's positions stay valid
  let out = keymap;
  out = out.slice(0, spans[n][0]) + rebuild(layer, nl) + out.slice(spans[n][1]);
  out = out.slice(0, spans[0][0]) + rebuild(base, nb) + out.slice(spans[0][1]);
  return out;
}
