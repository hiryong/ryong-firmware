import {
  CSSProperties,
  PropsWithChildren,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Key } from "./Key";

export type KeyPosition = PropsWithChildren<{
  id: string;
  header?: string;
  /** keys.ryong.com: the small second line, shown as given */
  sub?: string;
  quiet?: boolean;
  /** an ISO Enter: where its bottom half starts, in key units from its left edge */
  isoNotch?: number;
  isoKx?: number;
  isoKy?: number;
  width: number;
  height: number;
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
}>;

export type LayoutZoom = number | "auto";

export function deserializeLayoutZoom(value: string): LayoutZoom {
  if (value === "auto") {
    return "auto";
  }
  return parseFloat(value) || "auto";
}

interface PhysicalLayoutProps {
  positions: Array<KeyPosition>;
  selectedPosition?: number;
  oneU?: number;
  hoverZoom?: boolean;
  zoom?: LayoutZoom;
  onPositionClicked?: (position: number) => void;
}

interface PhysicalLayoutPositionLocation {
  x: number;
  y: number;
  r?: number;
  rx?: number;
  ry?: number;
}

function scalePosition(
  { x, y, r, rx, ry }: PhysicalLayoutPositionLocation,
  oneU: number,
): CSSProperties {
  let left = x * oneU;
  let top = y * oneU;
  let transformOrigin = undefined;
  let transform = undefined;
  const transformStyle = "preserve-3d";

  if (r) {
    // Use `??` so an explicit rotation origin of 0 is honored; `rx || x`
    // collapsed a legitimate 0 back to the key's own position, pivoting the
    // key around its own corner instead of the layout origin (#97).
    let transformX = ((rx ?? x) - x) * oneU;
    let transformY = ((ry ?? y) - y) * oneU;
    transformOrigin = `${transformX}px ${transformY}px`;
    transform = `rotate(${r}deg)`;
  }

  return {
    top,
    left,
    transformOrigin,
    transform,
    transformStyle,
  };
}

export const PhysicalLayout = ({
  positions,
  selectedPosition,
  oneU = 48,
  onPositionClicked,
  ...props
}: PhysicalLayoutProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const parent = element.parentElement;
    if (!parent) return;

    const calculateScale = () => {
      if (props.zoom === "auto") {
        const padding = Math.min(window.innerWidth, window.innerHeight) * 0.05; // Padding when in auto mode
        const newScale = Math.min(
          2, // keys.ryong.com: never more than 200%, even on a big screen
          parent.clientWidth / (element.clientWidth + 2 * padding),
          parent.clientHeight / (element.clientHeight + 2 * padding),
        );
        setScale(newScale);
      } else {
        setScale(props.zoom || 1);
      }
    };

    calculateScale(); // Initial calculation

    const resizeObserver = new ResizeObserver(() => {
      calculateScale();
    });

    resizeObserver.observe(element);
    resizeObserver.observe(parent);

    return () => {
      resizeObserver.disconnect();
    };
  }, [props.zoom]);

  // TODO: Add a bit of padding for rotation when supported
  let rightMost = positions
    .map((k) => k.x + k.width)
    .reduce((a, b) => Math.max(a, b), 0);
  let bottomMost = positions
    .map((k) => k.y + k.height)
    .reduce((a, b) => Math.max(a, b), 0);

  // keys.ryong.com: ZMK describes an ISO Enter as a plain 1.25u × 2u (or 1.5u × 2u) box. Spot it — a tall key
  // at the end of two rows, the row above stopping short of it, the row below running into it — and draw
  // the real shape: 1.5u wide on top, a notch on the bottom left.
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const iso = (p: KeyPosition) => {
    if (p.r || p.height < 1.9 || p.height > 2.1 || p.width < 1.2 || p.width > 1.6) return null;
    const ends = (y: number) => positions.filter((q) => q !== p && near(q.y, y) && q.x < p.x).map((q) => q.x + q.width);
    const above = Math.max(-1, ...ends(p.y)), below = Math.max(-1, ...ends(p.y + 1));
    if (above < 0 || below < 0) return null;
    const left = Math.min(p.x, above); // the top reaches back to the key before it
    const notch = below - left; // how far the bottom half starts in
    if (notch < 0.2 || notch > 0.6 || p.x - left > 0.3) return null;
    return { left, notch };
  };

  const positionItems = positions.map((p0, idx) => {
    const shape = iso(p0);
    const p = shape
      ? { ...p0, x: shape.left, width: p0.width + (p0.x - shape.left), isoNotch: shape.notch,
          isoKx: ((shape.left + (p0.width + p0.x - shape.left) / 2) / rightMost) * 2 - 1,
          isoKy: bottomMost > 1 ? p0.y / (bottomMost - p0.height) : 0 }
      : p0;
    return (
    <div
      className="absolute hover:z-10"
      style={{
        ...scalePosition(p, oneU),
        // keys.ryong.com 3D view: where the key sits, -1 (left) … 1 (right) and 0 (back) … 1 (front),
        // so each cap shows the sides you would actually see from the middle
        ["--kx" as string]: ((p.x + p.width / 2) / rightMost) * 2 - 1,
        ["--ky" as string]: bottomMost > 1 ? p.y / (bottomMost - p.height) : 0,
      }}
    >
      <div
        key={p.id}
        onClick={() => onPositionClicked?.(idx)}
      >
        <Key
          oneU={oneU}
          selected={idx === selectedPosition}
          {...p}
        />
      </div>
    </div>
    );
  });

  return (
    <div
      className="relative"
      style={{
        height: bottomMost * oneU + "px",
        width: rightMost * oneU + "px",
        transform: `scale(${scale})`,
        transformStyle: "preserve-3d",
      }}
      ref={ref}
      {...props}
    >
      {positionItems}
    </div>
  );
};
