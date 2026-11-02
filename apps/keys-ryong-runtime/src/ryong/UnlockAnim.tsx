import { useId } from "react";
import { shortKey } from "./power";

// Keycaps seen from slightly above with hands pressing them (unlock, bootloader, Soft Off, combos).
// "together" = a combo (all at once), "hold" = hold the first key, then press the rest together.
// The keycaps are SVG (so the legends are whatever keys this keyboard uses); the hand is one render
// (public/ryong-hand.webp, a right hand), mirrored for the left.

type Mode = "together" | "hold" | "single";

/** A polygon with rounded corners (r) as an SVG path. */
function rounded(pts: [number, number][], r: number) {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[(i + n - 1) % n];
    const [nx, ny] = pts[(i + 1) % n];
    const l1 = Math.hypot(px - x, py - y), l2 = Math.hypot(nx - x, ny - y);
    const a: [number, number] = [x + ((px - x) / l1) * Math.min(r, l1 / 2), y + ((py - y) / l1) * Math.min(r, l1 / 2)];
    const b: [number, number] = [x + ((nx - x) / l2) * Math.min(r, l2 / 2), y + ((ny - y) / l2) * Math.min(r, l2 / 2)];
    d += `${i ? "L" : "M"}${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${x} ${y} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return d + "Z";
}

/** The outline (convex hull) of a set of points, in order. */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

// One camera for every key: lines going away from the viewer meet at VP, so a key left of centre leans right.
const VP: [number, number] = [200, -560];
const TOP0 = 90, EDGE0 = 136, BASE0 = 160; // far edge and near edge of the key tops, bottom of the skirts (nearest row)
const toward = (x: number, y: number, ty: number) => x + (VP[0] - x) * ((y - ty) / (y - VP[1]));

// The legend is set on a flat card (the key top seen from straight above) and the card is
// mapped onto the projected top with a perspective transform.
const FLAT_H = 56; // every key is as deep as the next; its width is its own
/** CSS matrix3d taking the box w × h onto the quad p (top-left, top-right, bottom-right, bottom-left). */
function onto(w: number, h: number, p: [number, number][]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(6)).join(",")})`;
}

const WEBKIT = typeof navigator !== "undefined" && /AppleWebKit/.test(navigator.userAgent) &&
  (!/Chrome|Chromium|Edg|OPR/.test(navigator.userAgent) || /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent));

const Key = ({ cx, w, dy, label, legend, role, uid }: { cx: number; w: number; dy: number; label: string; legend: number; role: string; uid: string }) => {
  const x1 = cx - w / 2, x2 = cx + w / 2;
  const TOP = TOP0 - dy, EDGE = EDGE0 - dy, BASE = BASE0 - dy;
  const f1 = toward(x1, EDGE, TOP), f2 = toward(x2, EDGE, TOP);
  // the dish: the same quad, pulled in a little
  const d = 6, ins = 5;
  const dn1 = x1 + d, dn2 = x2 - d, df1 = toward(dn1, EDGE - ins, TOP + ins), df2 = toward(dn2, EDGE - ins, TOP + ins);
  // the skirt: everything between the top and the (slightly wider) foot, which is the top dropped by the
  // cap's height. Its outline takes in the side facing the middle, which the camera sees past the top.
  const drop = BASE - EDGE;
  const foot: [number, number][] = [
    [toward(x1 - 4, BASE, TOP + drop), TOP + drop], [toward(x2 + 4, BASE, TOP + drop), TOP + drop],
    [x2 + 4, BASE], [x1 - 4, BASE],
  ];
  const skirt = hull([[f1, TOP], [f2, TOP], [x2, EDGE], [x1, EDGE], ...foot]);
  return (
    <g className={`ua-key ua-${role}`}>
      <ellipse className="ua-shadow" cx={cx} cy={BASE + 4} rx={w / 2 + 6} ry={6} />
      <g className="ua-cap">
        <path className="ua-skirt" fill={`url(#${uid}skirt)`} d={rounded(skirt, 6)} />
        <path className="ua-top" fill={`url(#${uid}top)`} d={rounded([[f1, TOP], [f2, TOP], [x2, EDGE], [x1, EDGE]], 8)} />
        <path className="ua-dish" d={rounded([[df1, TOP + ins], [df2, TOP + ins], [dn2, EDGE - ins], [dn1, EDGE - ins]], 7)} />
        {/* printed on the top: the word is laid out flat, then mapped onto the key top's four corners
            (a true perspective, so it narrows toward the back like the top does, rather than slanting) */}
        {/* WebKit (Safari and every iPhone browser) places transformed HTML inside SVG relative to the page,
            so the printed word floats away from the key there; draw it as SVG text instead. */}
        {WEBKIT ? (
          <text className="ua-legend" x={legend} y={TOP + (EDGE - TOP) * 0.42} textAnchor="middle" dominantBaseline="middle"
            transform={`translate(${legend} ${TOP}) scale(1 0.82) translate(${-legend} ${-TOP})`}>{label}</text>
        ) : (
        <foreignObject x={0} y={0} width={1} height={1} overflow="visible">
          <div className="ua-legend-flat ua-legend" style={{ width: x2 - x1, height: FLAT_H, transform: onto(x2 - x1, FLAT_H, [[f1, TOP], [f2, TOP], [x2, EDGE], [x1, EDGE]]) }}>
            <span style={{ left: legend - x1 }}>{label}</span>
          </div>
        </foreignObject>
        )}
      </g>
    </g>
  );
};

// the hand render: fingertip at (82, 0) in a 269 × 474 image
const HAND = { w: 269, h: 474, tipX: 82, scale: 0.62 };

/**
 * A hand reaching up from the typist's side with its index fingertip at (x, y). The render is cut in two —
 * the index finger and the rest of the hand — so the finger can flex on its knuckle while the hand moves.
 */
const Hand = ({ x, y, left, k, role }: { x: number; y: number; left: boolean; k: number; role: string }) => {
  const id = useId().replace(/:/g, "");
  const img = <image href="/ryong-hand.webp" x={-HAND.tipX} y={-1} width={HAND.w} height={HAND.h} preserveAspectRatio="none" />;
  // in the hand's own coordinates (fingertip at 0,0): the index finger is the column x -27..43 above the knuckle (y 145)
  return (
    <g transform={`translate(${x} ${y}) scale(${left ? -k : k} ${k}) rotate(-12)`}>
      <defs>
        {/* the two pieces overlap instead of meeting on a line: the finger reaches 3 px past the cut on each
            side and fades out below the knuckle over the palm, so no seam shows when it bends */}
        <linearGradient id={`${id}fg`} gradientUnits="userSpaceOnUse" x1="0" y1="153" x2="0" y2="186">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id={`${id}f`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={-40} y={-20} width={100} height={210}>
          <rect x={-27} y={-10} width={70} height={200} fill={`url(#${id}fg)`} />
        </mask>
        <clipPath id={`${id}p`}>
          <path d={`M-200 148 H300 V600 H-200 Z M40 -10 H300 V148 H40 Z M-200 -10 H-24 V148 H-200 Z`} />
        </clipPath>
      </defs>
      <g className={`ua-finger ua-${role}`}>
        <g className="ua-tilt">
          <g clipPath={`url(#${id}p)`}>{img}</g>
          <g className="ua-flex" mask={`url(#${id}f)`}>
            {img}
          </g>
        </g>
      </g>
    </g>
  );
};

const short = (k: string) => shortKey(k);

/** A key to draw: name and place on the board ([x, y, width] in 1/100 key units). */
export interface AnimKey {
  label: string;
  x: number;
  y: number;
  w: number;
}

const UNIT = 70; // px per key unit

/**
 * Lay the keys out as they sit on the board: left to right in board order, the gap growing (a little)
 * with the real distance between them.
 */
function place(keys: AnimKey[], mode: string) {
  // only left/right matters: every key sits on the same line, in board order
  const ks = [...keys].sort((a, b) => a.x - b.x).slice(0, 5);
  const n = ks.length;
  // drawn widths: at least 1.25u; wider keys (Tab, Caps, Backspace, Shift, Enter) 1.75u; Space and other long
  // keys 6u at the ends of a pair (they run off the side) — with three or more keys a long key at an end is
  // 2.25u and one in the middle shrinks to Shift size, so everything still fits
  const units = (w: number, i: number) => (w <= 125 ? 1.25 : w < 400 ? 1.75 : n <= 2 ? 6 : i === 0 || i === n - 1 ? 2.25 : 1.75);
  const out = ks.map((k, i) => ({ ...k, label: short(k.label), dy: 0, px: units(k.w, i) * UNIT, s: 1 }));
  const gaps = out.map((_, i) => (i === 0 ? 0 : Math.min(n > 2 ? 40 : 64, 20 + Math.max(0, ks[i].x - (ks[i - 1].x + ks[i - 1].w)) * 0.05)));
  // more keys than fit: draw them all a little smaller
  const total = out.reduce((a, k) => a + k.px, 0) + gaps.reduce((a, g) => a + g, 0);
  const fit = n > 2 ? Math.min(1, 440 / total) : 1;
  let x = 0;
  const lefts = out.map((k, i) => {
    k.px *= fit;
    x += gaps[i] * fit;
    const l = x;
    x += k.px;
    return l;
  });
  // the two keys the hands press: the outer two. Holding (Fn, then the rest together): one finger holds the
  // first key, the other hand presses the key of the rest farthest from it; the others go down with it
  let hands = n === 1 ? [0] : [0, n - 1];
  if (mode === "hold" && n > 2) {
    const held = Math.max(0, ks.indexOf(keys[0]));
    const other = held < n - 1 - held ? n - 1 : 0;
    hands = [held, other].sort((a, b) => a - b);
  }
  // where each finger lands: the middle of the key, or on a long key the end facing the other hand
  const tips = out.map((k, i) => {
    if (k.px <= 2 * UNIT || n === 1) return lefts[i] + k.px / 2;
    return i === hands[0] ? lefts[i] + k.px - UNIT * 0.9 : lefts[i] + UNIT * 0.9;
  });
  // centre the hands (a long key may run off the side, fading out there); with three or more keys centre
  // the whole row instead, so no key ends up in the faded edge
  const shift = n > 2 ? 200 - x / 2 : 200 - (tips[hands[0]] + tips[hands[hands.length - 1]]) / 2;
  return out.map((k, i) => {
    const l = lefts[i] + shift, r = l + k.px;
    const visL = Math.max(l, -10), visR = Math.min(r, 410);
    return { ...k, cx: l + k.px / 2, tip: tips[i] + shift, legend: (visL + visR) / 2, hand: hands.includes(i), leftHand: hands.length > 1 && i === hands[0] };
  });
}

/**
 * Keycaps being pressed. mode: "together" (a combo), "hold" (hold the first, then press the rest together),
 * "single", or "long" (both held down for a few seconds, e.g. Soft Off; `seconds` is shown above them).
 * hands = false draws the keys going down on their own.
 */
export const KeyPress = ({ keys, mode, hands = true, seconds }: { keys: AnimKey[]; mode: Mode | "long"; hands?: boolean; seconds?: number }) => {
  const uid = useId().replace(/:/g, "");
  const placed = place(keys, mode);
  const role = (i: number) => (mode === "single" ? "solo" : mode === "hold" ? (keys[0].x === placed[i].x && keys[0].y === placed[i].y ? "first" : "second") : mode === "long" ? "long" : "together");
  const left = Math.min(...placed.map((k) => k.cx - k.px / 2)), right = Math.max(...placed.map((k) => k.cx + k.px / 2));
  return (
    <svg className={`ry-unlock-anim ua-${mode}${hands ? "" : " ua-nohands"}`} viewBox={hands ? (mode === "long" ? "-30 36 460 274" : "-30 60 460 250") : "-30 40 460 140"} role="img" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2A2B2F" />
          <stop offset="1" stopColor="#1B1C1F" />
        </linearGradient>
        {/* the skirt fades into the dark instead of ending on a hard bottom edge */}
        <linearGradient id={`${uid}skirt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C1D20" />
          <stop offset="0.55" stopColor="#151619" />
          <stop offset="1" stopColor="#151619" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}fade`} gradientUnits="userSpaceOnUse" x1="0" y1="252" x2="0" y2="308">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <linearGradient id={`${uid}sides`} gradientUnits="userSpaceOnUse" x1="-30" y1="0" x2="430" y2="0">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.09" stopColor="#fff" />
          <stop offset="0.91" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id={`${uid}side`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-100" y="-100" width="600" height="500">
          <rect x="-100" y="-100" width="600" height="500" fill={`url(#${uid}sides)`} />
        </mask>
        <mask id={`${uid}mask`} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="-100" y="-100" width="600" height="500">
          <rect x="-100" y="-100" width="600" height="500" fill={`url(#${uid}fade)`} />
        </mask>
      </defs>
      {mode === "long" && (
        // how long to hold: a thin line above the keys that fills while they're down
        <g className="ua-hold-meter">
          <line className="ua-meter-track" x1={Math.max(left, 0)} x2={Math.min(right, 400)} y1={TOP0 - 22} y2={TOP0 - 22} />
          <line className="ua-meter-fill" x1={Math.max(left, 0)} x2={Math.min(right, 400)} y1={TOP0 - 22} y2={TOP0 - 22} pathLength={100} />
          {seconds != null && (
            <text className="ua-meter-label" x={Math.min(right, 400)} y={TOP0 - 30} textAnchor="end">
              {seconds} s
            </text>
          )}
        </g>
      )}
      <g mask={`url(#${uid}side)`}>
        {placed.map((k, i) => (
          <Key key={i} uid={uid} cx={k.cx} w={k.px} dy={k.dy} label={k.label} legend={k.legend} role={role(i)} />
        ))}
      </g>
      {hands && (
        <g mask={`url(#${uid}mask)`}>
          {placed.map((k, i) =>
            k.hand ? <Hand key={i} x={k.tip} y={EDGE0 - k.dy - 13} k={HAND.scale * k.s} left={k.leftHand} role={role(i)} /> : null,
          )}
        </g>
      )}
    </svg>
  );
};

export const UnlockAnim = KeyPress;
