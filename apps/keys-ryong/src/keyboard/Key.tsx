import { PropsWithChildren, useId } from "react";
import BehaviorShortNames from "./behavior-short-names.json";

interface KeyProps {
  selected?: boolean;
  width: number;
  height: number;
  oneU: number;
  header?: string;
  sub?: string;
  quiet?: boolean;
  isoNotch?: number;
  isoKx?: number;
  isoKy?: number;
  onClick?: () => void;
}

interface BehaviorShortName {
  short?: string;
}

const MAX_HEADER_LENGTH = 9;
const shortNames: Record<string, BehaviorShortName> = BehaviorShortNames;

const shortenHeader = (header: string | undefined) => {
  if(typeof header === "undefined"){
    return "";
  }
  // Empty string is a valid header for behaviors where we don't want to see a header, which is falsy
  // So we use an undefined check here
  if(typeof shortNames[header]?.short !== "undefined"){
    return shortNames[header].short;
  } else if(header.length > MAX_HEADER_LENGTH){
    const words = header.split(/[\s,-]+/);
    const lettersPerWord = Math.trunc(MAX_HEADER_LENGTH / words.length);
    return words.map((word) => (word.substring(0,lettersPerWord))).join("");
  } else {
    return header;
  }
}

export const Key = ({
  selected = false,
  width,
  height,
  oneU,
  header,
  sub,
  quiet,
  isoNotch,
  isoKx = 0,
  isoKy = 0.5,
  onClick,
  children,
}: PropsWithChildren<KeyProps>) => {
  const pixelWidth = width * oneU - 2;
  const pixelHeight = height * oneU - 2;

  return (
    <button
      className={`ry-key${quiet ? " is-quiet" : ""}${isoNotch ? " is-iso" : ""} group rounded relative flex justify-center items-center cursor-pointer transition-all hover:shadow-xl hover:ring-1 hover:ring-gray-300 hover:scale-125 ${selected ? "bg-primary text-primary-content" : "bg-base-100 text-base-content"
        }`}
      style={{
        width: `${pixelWidth}px`,
        height: `${pixelHeight}px`,
        ...(isoNotch ? { ["--nx" as string]: `${isoNotch * oneU}px`, ["--ny" as string]: `${oneU - 1}px`, ["--kh" as string]: `${pixelHeight}px` } : {}),
      }}
      onClick={onClick}
    >
      <div className={`absolute text-xs ${selected ? "text-primary-content" : "z1text-base-content"} opacity-80 top-1 text-nowrap left-1/2 font-light -translate-x-1/2 text-center`}>{sub ?? shortenHeader(header)}</div>
      {children}
      {isoNotch ? <IsoShape w={pixelWidth} h={pixelHeight} nx={isoNotch * oneU} ny={oneU - 1} kx={isoKx} ky={isoKy} /> : null}
    </button>
  );
};

/**
 * keys.ryong.com: an ISO Enter, drawn as one L-shaped outline with every corner rounded — the inside one
 * too — for 2D, and as a cap (skirt + top) with the same insets as the other 3D caps (see ryong.css).
 */
function lPath(x0: number, y0: number, x1: number, y1: number, nx: number, ny: number, r: number, ri: number) {
  return [
    `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}`,
    `V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
    `H${nx + r}A${r} ${r} 0 0 1 ${nx} ${y1 - r}`,
    `V${ny + ri}A${ri} ${ri} 0 0 0 ${nx - ri} ${ny}`,
    `H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${ny - r}`,
    `V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`,
  ].join("");
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function IsoShape({ w, h, nx, ny, kx, ky }: { w: number; h: number; nx: number; ny: number; kx: number; ky: number }) {
  const id = useId().replace(/:/g, "");
  // the same numbers as the 3D caps' --g, --l, --r, --t, --b in ryong.css
  const g = 2, l = clamp(4 + 4 * kx, 1.5, 8), r = clamp(4 - 4 * kx, 1.5, 8), t = 0.5 + 2.5 * ky, b = 12 - 3 * ky;
  const sh = h - 2 * g;
  return (
    <svg className="ry-iso-shape" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--skirt-a)" }} />
          <stop offset={1 - (b + 2) / sh} style={{ stopColor: "var(--skirt-a)" }} />
          <stop offset={1 - (b * 0.45) / sh} style={{ stopColor: "var(--skirt-b)" }} />
          <stop offset="1" style={{ stopColor: "var(--skirt-c)" }} />
        </linearGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--top-a)" }} />
          <stop offset="1" style={{ stopColor: "var(--top-b)" }} />
        </linearGradient>
      </defs>
      <path className="ry-iso-flat" d={lPath(0.5, 0.5, w - 0.5, h - 0.5, nx + 0.5, ny - 0.5, 6, 4)} />
      <g className="ry-iso-cap">
        <path fill={`url(#${id}s)`} d={lPath(g, g, w - g, h - g, nx + g, ny - g, 4, 3)} />
        <path fill={`url(#${id}t)`} d={lPath(g + l, g + t, w - g - r, h - g - b, nx + g + l, ny - g - b, 4, 3)} />
      </g>
    </svg>
  );
}
