// One key on the keyboard (and which layer), picked on a small keyboard map, for "put this on a key".
import type { KeyRect } from "./layouts";
import { t } from "../i18n";
import { legendFit, type Legend } from "../keyLegend";
import { KeyIcon } from "../KeyIcon";

export function KeyPick({ keys, layers, layer, pos, onLayer, onPick, legendAt }: {
  keys: KeyRect[]; layers: string[]; layer: number; pos?: number;
  onLayer: (layer: number) => void; onPick: (pos: number) => void;
  /** what the key does on this layer now, drawn as on the keymap (falls back to the printed legend) */
  legendAt?: (layer: number, pos: number, widthU: number) => Legend | undefined;
}) {
  const w = Math.max(...keys.map(([x, , kw]) => x + kw), 100);
  const h = Math.max(...keys.map(([, y, , kh]) => y + kh), 100);
  return <div className="ry-combopick">
    {layers.length > 1 && <div className="ry-gap" role="group" aria-label={t("Layer", "레이어")}>
      {layers.map((n, i) => <button key={i} type="button" className="ry-chip" aria-pressed={i === layer} onClick={() => onLayer(i)}>{n || t("Layer {n}", "레이어 {n}", { n: i })}</button>)}
    </div>}
    <div className="ry-combokeys" style={{ aspectRatio: `${w} / ${h}` }}>
      {keys.map(([x, y, kw, kh, label], i) => <button key={i} type="button" aria-pressed={pos === i}
        style={{ left: `${(x / w) * 100}%`, top: `${(y / h) * 100}%`, width: `${(kw / w) * 100}%`, height: `${(kh / h) * 100}%` }}
        onClick={() => onPick(i)}>{(() => {
          // same legend rules as the keymap: ▽ for see-through keys, icons for media and arrows,
          // long names shrunk or set on two lines instead of cut off
          const lg = legendAt?.(layer, i, kw / 100) ?? { main: label };
          const f = legendFit(lg.main, kw / 100);
          return <span className={lg.quiet ? "is-quiet" : undefined} data-ry-long={!lg.icon && f.lines > 1 ? "" : undefined}
            style={{ ["--fit" as string]: lg.icon ? 1 : f.fit }} title={lg.quiet && lg.main === "▽" ? t("Transparent: uses the layer below", "투명: 아래 레이어 키 사용") : undefined}>
            {lg.sub && <small className="ry-kp-sub">{lg.sub}</small>}
            {lg.icon ? <KeyIcon name={lg.icon} label={lg.main} /> : lg.main}</span>;
        })()}</button>)}
    </div>
  </div>;
}
