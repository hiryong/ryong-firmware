// Which keys unlock a keyboard, worked out before it is unlocked.
//
// The keyboard won't tell (that's the point of the lock), but the site often knows the keyboard:
// - a shared or own keyboard can say it outright (Board.unlockKey, e.g. "Fn + \")
// - otherwise its .keymap on GitHub is read and &studio_unlock is looked up: on the base layer it is one
//   key; on another layer it is "the key that switches to that layer + the key in that spot"; in a combo
//   it is the combo's keys.
// The answer is remembered per keyboard name in this browser, so it also shows offline next time.


export interface UnlockHint {
  keys: string[];
  /** how to press them: together (combo), hold the first ones then press the last, or just the one key */
  how: "together" | "hold" | "one";
  /** where the Fn key is, when it was worked out from the keymap */
  fnAt?: "corner" | "bottom";
  /** only on another layer, with no key on the base layer that reaches it */
  layer?: string;
  /** where the answer came from: a keyboard name, and whether it came from its keymap file */
  from: string;
  fromKeymap?: boolean;
}

type Found = Omit<UnlockHint, "from" | "fromKeymap">;

const KEY: Record<string, string> = {
  BSLH: "\\", BACKSLASH: "\\", NON_US_BSLH: "\\", RET: "Enter", ENTER: "Enter", RETURN: "Enter", ESC: "Esc", ESCAPE: "Esc",
  SPACE: "Space", SPC: "Space", BSPC: "Backspace", BACKSPACE: "Backspace", TAB: "Tab", DEL: "Delete", DELETE: "Delete",
  GRAVE: "`", MINUS: "-", EQUAL: "=", LBKT: "[", RBKT: "]", SEMI: ";", SEMICOLON: ";", SQT: "'", APOS: "'",
  COMMA: ",", DOT: ".", PERIOD: ".", FSLH: "/", SLASH: "/", CAPS: "Caps Lock", CAPSLOCK: "Caps Lock",
  LSHFT: "Left Shift", LSHIFT: "Left Shift", RSHFT: "Right Shift", RSHIFT: "Right Shift", LCTRL: "Left Ctrl",
  RCTRL: "Right Ctrl", LALT: "Left Alt", RALT: "Right Alt", LGUI: "Left Cmd/Win", RGUI: "Right Cmd/Win",
  UP: "↑", DOWN: "↓", LEFT: "←", RIGHT: "→", HOME: "Home", END: "End", PG_UP: "Page Up", PG_DN: "Page Down",
  INS: "Insert", PSCRN: "Print Screen",
};

export function keyName(binding: string[] | undefined): string | null {
  if (!binding) return null;
  const [b, p] = binding;
  if (b === "&gresc") return "Esc";
  if (b === "&kp" && p) {
    const m = p.match(/^N(\d)$/) || p.match(/^NUMBER_(\d)$/);
    if (m) return m[1];
    if (/^[A-Z]$/.test(p) || /^F\d{1,2}$/.test(p)) return p;
    return KEY[p] || p;
  }
  if (b === "&lt" || b === "&mt") return keyName(["&kp", binding[2]]);
  return null;
}


/** Parse a .keymap well enough to find &studio_unlock. Exported for tests. */
export function hintFromKeymap(src: string): Found | null {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const defines: Record<string, string> = {};
  for (const m of text.matchAll(/^\s*#define\s+(\w+)\s+(\S+)/gm)) defines[m[1]] = m[2];
  const num = (s: string) => Number(defines[s] ?? s);

  const tokenize = (b: string) => {
    const out: string[][] = [];
    for (const t of b.trim().split(/\s+/)) {
      if (!t) continue;
      if (t.startsWith("&")) out.push([t]);
      else if (out.length) out[out.length - 1].push(t);
    }
    return out;
  };

  // innermost nodes that have bindings: layers (inside the keymap node) and combos
  const layers: { name: string; keys: string[][] }[] = [];
  const combos: { positions: number[]; keys: string[][] }[] = [];
  const km = text.indexOf('"zmk,keymap"');
  const combosAt = text.indexOf('"zmk,combos"');
  for (const m of text.matchAll(/([\w-]+)\s*(?::\s*[\w-]+\s*)?\{([^{}]*)\}/g)) {
    const body = m[2];
    const b = body.match(/bindings\s*=\s*<([^>]*)>/);
    if (!b || /#binding-cells|compatible/.test(body)) continue;
    const pos = body.match(/key-positions\s*=\s*<([^>]*)>/);
    if (pos) {
      if (combosAt >= 0) combos.push({ positions: pos[1].trim().split(/\s+/).map(num), keys: tokenize(b[1]) });
      continue;
    }
    if (km >= 0 && (m.index ?? 0) > km) {
      const dn = body.match(/(?:display-name|label)\s*=\s*"([^"]*)"/);
      layers.push({ name: dn ? dn[1] : m[1], keys: tokenize(b[1]) });
    }
  }
  if (!layers.length) return null;
  const base = layers[0].keys;

  const combo = combos.find((c) => c.keys.some((k) => k[0] === "&studio_unlock"));
  if (combo) {
    return { keys: combo.positions.map((p) => keyName(base[p]) || `#${p + 1}`), how: "together" };
  }

  for (let l = 0; l < layers.length; l++) {
    const i = layers[l].keys.findIndex((k) => k[0] === "&studio_unlock");
    if (i < 0) continue;
    const at = keyName(base[i]) || `#${i + 1}`;
    if (l === 0) return { keys: [at], how: "one" };
    // the key on the base layer that reaches layer l
    const j = base.findIndex((k) => ["&mo", "&lt", "&sl", "&tog", "&to"].includes(k[0]) && num(k[1]) === l);
    if (j < 0) return { keys: [at], how: "one", layer: layers[l].name };
    const k = base[j];
    // A key that only opens another layer has no legend of its own; on keyboards like these it is the
    // Fn key, whatever the keymap calls the layer ("raise", "lower"…).
    if (k[0] === "&lt") return { keys: [keyName(base[j]) || `#${j + 1}`, at], how: "hold" };
    const fnAt = j === base.length - 1 ? "corner" : j >= base.length - 8 ? "bottom" : undefined;
    return { keys: ["Fn", at], how: "hold", fnAt };
  }
  return null;
}
