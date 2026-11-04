// One key on the keyboard (and which layer), picked on a small keyboard map, for "put this on a key".
import type { KeyRect } from "./layouts";
import { t } from "../i18n";

export function KeyPick({ keys, layers, layer, pos, onLayer, onPick, labelAt }: {
  keys: KeyRect[]; layers: string[]; layer: number; pos?: number;
  onLayer: (layer: number) => void; onPick: (pos: number) => void;
  /** what the key does on this layer now (falls back to the printed legend) */
  labelAt?: (layer: number, pos: number) => string | undefined;
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
        onClick={() => onPick(i)}><span>{labelAt?.(layer, i) ?? label}</span></button>)}
    </div>
  </div>;
}
