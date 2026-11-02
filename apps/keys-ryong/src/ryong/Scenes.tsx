// Small looping pictures in the same matte style as the keycaps (UnlockAnim):
// - FlashAnim: the .uf2 file dragged onto the keyboard's drive, which then restarts as the keyboard
// - ConnectAnim: plug in by USB, pick the keyboard in the browser's list, connected
import { useId } from "react";
import { t } from "./i18n";
import { LAYOUTS } from "./behaviors/layouts";

const CURSOR = "M0 0 L0 15 L4 11.5 L7 18 L9.6 16.8 L6.7 10.6 L11.6 10.6 Z";

/** A document with a folded corner, its top-left at (0,0). */
const Doc = ({ label }: { label: string }) => (
  <g>
    <path className="sc-doc" d="M5 0 H25 L36 11 V43 Q36 48 31 48 H5 Q0 48 0 43 V5 Q0 0 5 0 Z" />
    <path className="sc-doc-fold" d="M25 0 V8 Q25 11 28 11 H36" />
    <text className="sc-doc-label" x={18} y={33} textAnchor="middle">
      {label}
    </text>
  </g>
);

/**
 * The keyboard, seen from the front and above with one real camera: a 60% ANSI board (the 61 keys at their
 * real widths — 1.5u Tab, 1.75u Caps, 2.25u/2.75u Shifts, 6.25u Space) on a thin plate. Every keycap is a
 * box with a smaller top, projected through the same camera, so the sides you see follow the perspective.
 */
const MiniBoard = ({ x, y, w }: { x: number; y: number; w: number }) => {
  const id = useId().replace(/:/g, "");
  const keys = LAYOUTS["60-ansi"];
  const pad = w * 0.012; // a slim bezel
  const u = (w - pad * 2) / 15;
  const h = u * 5 + pad * 2;
  // camera: looking down at the board from the front, 58° above it, from about two board-widths away
  const phi = (58 * Math.PI) / 180, dist = w * 2.1;
  const sin = Math.sin(phi), cos = Math.cos(phi);
  const raw = (X: number, Y: number, Z: number): [number, number] => {
    const xc = X - w / 2, yc = Y - h / 2;
    const depth = dist - yc * cos - Z * sin;
    const f = dist / depth;
    return [w / 2 + xc * f, yc * sin * f - Z * cos * f];
  };
  const top0 = raw(w / 2, 0, 0)[1];
  const Pt = (X: number, Y: number, Z = 0): [number, number] => {
    const [a, b] = raw(X, Y, Z);
    return [a, b - top0];
  };
  const box = (x1: number, y1: number, x2: number, y2: number, z1: number, z2: number, ins: [number, number, number, number]) => {
    const [l, t, r, f] = ins;
    const base = [Pt(x1, y1, z1), Pt(x2, y1, z1), Pt(x2, y2, z1), Pt(x1, y2, z1)];
    const top: [number, number][] = [Pt(x1 + l, y1 + t, z2), Pt(x2 - r, y1 + t, z2), Pt(x2 - r, y2 - f, z2), Pt(x1 + l, y2 - f, z2)];
    return { hull: hull([...base, ...top]), top };
  };
  const plate = box(0, 0, w, h, -10, 0, [0, 0, 0, 0]); // the case: a slim bezel, a little height
  const H = u * 0.56; // keycap height
  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        {/* like the keycaps with the hands: a lighter top, sides that fade into the dark */}
        <linearGradient id={`${id}top`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#37383D" />
          <stop offset="1" stopColor="#2B2C30" />
        </linearGradient>
        <linearGradient id={`${id}edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.02" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.05" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.14" />
        </linearGradient>
        <linearGradient id={`${id}side`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C1D21" />
          <stop offset="0.55" stopColor="#111214" />
          <stop offset="1" stopColor="#111214" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <path className="sc-board-edge" d={rounded(plate.hull, 4)} />
      {/* the case edge fades out toward the back, so it doesn't peek through between the top row's caps */}
      <path className="sc-board" stroke={`url(#${id}edge)`} d={rounded(plate.top, 4)} />
      {keys.map(([kx, ky, kw], i) => {
        const g = u * 0.045; // half the gap between keys
        const x1 = pad + (kx / 100) * u + g, x2 = pad + ((kx + kw) / 100) * u - g;
        const y1 = pad + (ky / 100) * u + g, y2 = y1 + u - g * 2;
        // a cap: its top is smaller than its base, a little more so at the front
        const k = box(x1, y1, x2, y2, 0, H, [u * 0.1, u * 0.05, u * 0.1, u * 0.13]);
        return (
          <g key={i}>
            <path fill={`url(#${id}side)`} d={rounded(k.hull, Math.min(1.6, u * 0.14))} />
            <path fill={`url(#${id}top)`} d={rounded(k.top, Math.min(1.4, u * 0.12))} />
          </g>
        );
      })}
    </g>
  );
};

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

/** A polygon with rounded corners (r) as an SVG path. */
function rounded(pts: [number, number][], r: number) {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[(i + n - 1) % n];
    const [nx, ny] = pts[(i + 1) % n];
    const l1 = Math.hypot(px - x, py - y), l2 = Math.hypot(nx - x, ny - y);
    const a = [x + ((px - x) / l1) * Math.min(r, l1 / 2), y + ((py - y) / l1) * Math.min(r, l1 / 2)];
    const b = [x + ((nx - x) / l2) * Math.min(r, l2 / 2), y + ((ny - y) / l2) * Math.min(r, l2 / 2)];
    d += `${i ? "L" : "M"}${a[0].toFixed(2)} ${a[1].toFixed(2)}Q${x.toFixed(2)} ${y.toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
  }
  return d + "Z";
}

export const FlashAnim = () => (
  <svg className="ry-scene sc-flash" viewBox="0 0 400 150" role="img" aria-label={t("Drag the .uf2 onto the keyboard's drive", ".uf2 파일을 키보드 드라이브로 끌어다 놓기")}>
    {/* the drive the keyboard turns into in bootloader mode */}
    <g className="sc-drive">
      <rect className="sc-drive-body" x={232} y={50} width={120} height={56} rx={10} />
      <rect className="sc-drive-top" x={232} y={50} width={120} height={10} rx={5} />
      <circle className="sc-drive-led" cx={338} cy={95} r={2.6} />
    </g>
    {/* …which comes back as the keyboard */}
    <g className="sc-back">
      <MiniBoard x={216} y={48} w={152} />
      <circle className="sc-ok" cx={372} cy={44} r={3.2} />
    </g>
    {/* the file, carried by the pointer */}
    <g className="sc-drag">
      <g transform="translate(60 50)">
        <Doc label=".uf2" />
        <path className="sc-cursor" d={CURSOR} transform="translate(24 30)" />
      </g>
    </g>
  </svg>
);

export const ConnectAnim = ({ name }: { name?: string }) => (
  <svg className="ry-scene sc-connect" viewBox="0 0 400 150" role="img" aria-label={t("Plug in by USB, then choose the keyboard in the list", "USB로 연결한 뒤 목록에서 키보드 고르기")}>
    {/* keyboard and cable */}
    <defs>
      {/* the cable runs away from the viewer: it thins out and fades toward the top */}
      <linearGradient id="sc-cable-fade" gradientUnits="userSpaceOnUse" x1="0" y1="-30" x2="0" y2="40">
        <stop offset="0" stopColor="#3A3B3F" stopOpacity="0" />
        <stop offset="0.6" stopColor="#3A3B3F" />
        <stop offset="1" stopColor="#45464B" />
      </linearGradient>
      <linearGradient id="sc-plug-top" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7E8288" />
        <stop offset="1" stopColor="#A4A8AE" />
      </linearGradient>
    </defs>
    <g className="sc-plug">
      <path className="sc-cable" d="M104.6 40 C104.4 22 105.8 4 108.6 -30 H111.2 C112.2 4 112.6 22 111.4 40 Z" />
      {/* the housing seen from above: wider at the near end, like the case */}
      <path className="sc-plug-body" d="M101.5 39.5 Q101.6 37 104 37 H112 Q114.4 37 114.5 39.5 L115.6 52 Q115.6 55 112.8 55 H103.2 Q100.4 55 100.4 52 Z" />
      <path className="sc-plug-lip" d="M100.6 51.2 H115.4 L115.6 52 Q115.6 55 112.8 55 H103.2 Q100.4 55 100.4 52 Z" />
    </g>
    <MiniBoard x={20} y={55.4} w={176} />
    <circle className="sc-ok" cx={200} cy={52} r={3.2} />
    {/* the browser's device list */}
    <g className="sc-picker">
      <rect className="sc-panel" x={214} y={22} width={170} height={110} rx={10} />
      <text className="sc-panel-t" x={228} y={42}>
        {t("Select a device", "기기 선택")}
      </text>
      <rect className="sc-row sc-row-pick" x={222} y={52} width={154} height={22} rx={5} />
      <text className="sc-row-t" x={232} y={67}>
        {(name || t("Your keyboard", "내 키보드")).slice(0, 22)}
      </text>
      <text className="sc-row-t is-dim" x={232} y={91}>
        {t("Other device", "다른 기기")}
      </text>
      <rect className="sc-btn" x={316} y={104} width={60} height={20} rx={10} />
      <text className="sc-btn-t" x={346} y={118} textAnchor="middle">
        {t("Connect", "연결")}
      </text>
      <path className="sc-cursor sc-cursor-move" d={CURSOR} />
    </g>
  </svg>
);

/**
 * For phones and Safari: side by side, where it can't happen (the phone) and where it does (a computer, the
 * editor open). No link between them — the phone isn't part of it.
 */
export const ComputerAnim = () => (
  <svg className="ry-scene sc-handoff" viewBox="0 0 400 150" role="img" aria-label={t("Not on a phone: on a computer", "휴대폰이 아니라 컴퓨터에서")}>
    {/* the phone: not here */}
    <g className="sc-phone">
      <rect className="sc-device" x={52} y={26} width={58} height={104} rx={12} />
      <rect className="sc-screen" x={56} y={30} width={50} height={96} rx={9} />
      <rect className="sc-url" x={61} y={37} width={40} height={9} rx={4.5} />
      <text className="sc-url-t" x={81} y={43.6} textAnchor="middle">keys.ryong.com</text>
      <circle className="sc-x" cx={81} cy={84} r={14} />
      <path className="sc-x-mark" d="M76 79l10 10M86 79l-10 10" />
    </g>
    {/* the computer: here */}
    <g className="sc-laptop" transform="translate(-10 18)">
      <rect className="sc-device" x={226} y={14} width={140} height={84} rx={7} />
      <rect className="sc-screen" x={231} y={19} width={130} height={74} rx={4} />
      <path className="sc-device" d="M214 100h164l-6 7H220z" />
      <g className="sc-laptop-on">
        {/* the editor: a top bar with the mark, layers on the left, the keys */}
        <line className="sc-ed-line" x1={231} y1={28} x2={361} y2={28} />
        <circle className="sc-ed-mark" cx={237} cy={23.5} r={1.6} />
        <rect className="sc-ed-side" x={231} y={28} width={26} height={65} />
        <rect className="sc-ed-layer is-on" x={234} y={33} width={20} height={5} rx={2.5} />
        <rect className="sc-ed-layer" x={234} y={42} width={14} height={3} rx={1.5} />
        <rect className="sc-ed-layer" x={234} y={49} width={17} height={3} rx={1.5} />
        {/* the board, flat as the editor shows it: the 61 keys of a 60% at their real widths */}
        {LAYOUTS["60-ansi"].map(([kx, ky, kw], i) => (
          <rect key={i} className={`sc-ed-key${i === 20 ? " is-sel" : ""}`} x={263 + (kx / 100) * 6 + 0.4} y={45 + (ky / 100) * 6 + 0.4} width={(kw / 100) * 6 - 0.8} height={5.2} rx={1} />
        ))}
        <circle className="sc-ok" cx={354} cy={23.5} r={2.2} />
      </g>
    </g>
  </svg>
);
