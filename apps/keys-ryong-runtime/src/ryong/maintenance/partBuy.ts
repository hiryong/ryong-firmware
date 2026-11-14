import type { Part } from "./Board3D";

// What to buy to replace a part yourself: a generic spec anyone sells, equivalent part names, and a
// search for AliExpress (retail, small quantities). Values with a strict requirement say so.

export interface Buy { spec: [string, string]; alts?: string[]; note?: [string, string]; query: string }

const pkg = (fp: string) => /1206/.test(fp) ? "1206" : /0805/.test(fp) ? "0805" : /0603/.test(fp) ? "0603" : /0402/.test(fp) ? "0402" : "";
const ohm = (v: string) => v.replace(/k$/i, "kΩ").replace(/M$/, "MΩ").replace(/^(\d+(\.\d+)?)$/, "$1Ω");

export function buyInfo(p: Part): Buy | null {
  const v = p.value, size = pkg(p.footprint);
  switch (p.kind) {
    case "resistor":
      return { spec: [`${size} chip resistor ${ohm(v)}, 1%`, `${size} 칩 저항 ${ohm(v)} (1%)`], query: `${size} ${v} ohm SMD resistor` };
    case "capacitor":
      if (/7343/.test(p.footprint)) return { spec: [`Polymer tantalum capacitor ${v}, 7343 (D case)`, `고분자 탄탈 커패시터 ${v} (7343, D 케이스)`], alts: [p.part, "6TPE330MIL (2.8 mm tall)"],
        note: ["Mind the + mark (polarised). Same or higher voltage, low ESR.", "극성(+ 표시) 방향에 주의. 전압은 같거나 높게, 낮은 ESR."], query: `${v} 7343 polymer tantalum capacitor` };
      return { spec: [`${size} ceramic capacitor (MLCC) ${v}, X5R/X7R`, `${size} 세라믹 커패시터(MLCC) ${v}, X5R/X7R`],
        note: ["Same or higher voltage rating.", "전압 정격은 원래 부품과 같거나 높게."], query: `${size} ${v} MLCC capacitor` };
    case "inductor":
      return { spec: [`${size} inductor ${v}`, `${size} 인덕터 ${v}`], note: ["Same or higher current rating.", "정격 전류는 원래 부품과 같거나 높게."], query: `${size} ${v} inductor` };
    case "backlight":
      return { spec: ["1206 reverse-mount LED, white", "1206 역실장(reverse mount) 백색 LED"],
        note: ["Must be reverse-mount: it shines down through the board hole.", "꼭 역실장형이어야 해요. 기판 구멍을 통해 반대쪽으로 빛을 냅니다."], query: "1206 reverse mount LED white" };
    case "led":
      return { spec: [`0603 LED, ${v.toLowerCase()}`, `0603 LED, ${v === "RED" ? "빨강" : v}`], query: `0603 ${v.toLowerCase()} LED SMD` };
    case "diode":
      return { spec: ["1N4148WS switching diode, SOD-323", "1N4148WS 스위칭 다이오드 (SOD-323)"], alts: ["1N4148WS", "BAS316 (SOD-323)"],
        note: ["SOD-123 (1N4148W) is larger and does not fit.", "SOD-123 크기(1N4148W)는 더 커서 안 맞아요."], query: "1N4148WS SOD-323" };
    case "zener":
      return { spec: ["5.6 V zener diode, SOD-882 (0402 size)", "5.6V 제너 다이오드 (SOD-882, 0402 크기)"], alts: [v], query: `${v} zener` };
    case "underglow":
      return { spec: ["SK6812MINI-HS RGB LED, 3.5 × 3.5 mm", "SK6812MINI-HS RGB LED (3.5×3.5mm)"], alts: [v], query: "SK6812MINI-HS" };
    case "hotswap":
      return { spec: ["MX hot-swap socket", "MX 핫스왑 소켓"], alts: ["HanElectricity CPG151101S11-16", "Kailh CPG151101S11", "Gateron MX hot-swap socket"], query: "MX hot swap socket CPG151101S11" };
    case "usb":
      return { spec: ["USB-C receptacle, 16 pins, SMD", "USB-C 리셉터클 16핀 (SMD)"], alts: [v, "HRO TYPE-C-31-M-12"],
        note: ["Check the shell legs and pins match the footprint before swapping makers.", "다른 제조사 것은 다리·핀 위치가 같은지 도면으로 확인하세요."], query: "KH-TYPE-C-16P" };
    case "module":
      return { spec: [/MDBT50Q/.test(v) ? "Raytac nRF52840 module" : "EBYTE nRF52840 module", /MDBT50Q/.test(v) ? "Raytac nRF52840 모듈" : "EBYTE nRF52840 모듈"], alts: [v],
        note: ["Comes blank: it needs the bootloader flashed (SWD) after replacement.", "새 모듈은 비어 있어서 교체 후 부트로더를 SWD로 써야 해요."], query: v };
    case "transistor":
      return { spec: [`${v} MOSFET, SOT-23`, `${v} MOSFET (SOT-23)`], alts: [v], query: `${v} SOT-23` };
    case "esd":
      return { spec: ["USB ESD protection, SOT-23-6", "USB ESD 보호 칩 (SOT-23-6)"], alts: [v], query: v };
    case "fuse":
      return { spec: ["0805 resettable fuse (PPTC), 1.5 A hold, 6 V", "0805 리셋 퓨즈(PPTC) 1.5A 유지, 6V"], alts: ["0805L150SL"], query: "0805 PPTC 1.5A 6V resettable fuse" };
    case "crystal":
      return { spec: ["32.768 kHz crystal, 3.2 × 1.5 mm (3215)", "32.768kHz 크리스털 3.2×1.5mm (3215)"], alts: ["FC-135", "ABS07"],
        note: ["Same load capacitance (pF) as the original.", "부하 용량(pF)은 원래 부품과 같게."], query: "32.768kHz crystal 3215" };
    case "button":
      return { spec: ["SMD tact switch 5.1 × 5.1 mm, 4 pins", "SMD 택트 스위치 5.1×5.1mm 4핀"], alts: [v], query: "5.1x5.1 SMD tactile switch 4 pin" };
    case "slide":
      return { spec: ["Mini SMD slide switch", "소형 SMD 슬라이드 스위치"], alts: [v], query: v.replace(/-G\d+$/, "") + " slide switch" };
    case "connector":
      if (/^SM0(\d)B-SRSS/.test(v)) {
        const n = v[3];
        return { spec: [`JST SH 1.0 mm, ${n} pins, SMD right-angle`, `JST SH 1.0mm ${n}핀 SMD 직각형`], alts: [v], query: `JST SH 1.0mm ${n}P SMD horizontal` };
      }
      return { spec: ["Molex PicoBlade 1.25 mm, 3 pins, SMD right-angle", "Molex PicoBlade 1.25mm 3핀 SMD 직각형"], alts: [v], query: "1.25mm 3P SMD right angle connector PicoBlade" };
    case "ic": {
      const a = /24C128/.test(v) ? [v, "AT24C128 / 24C128 (TSSOP-8)"] : /BQ24075RGT/.test(v) ? ["BQ24075RGTR", "BQ24075RGTT"] : [v];
      return { spec: [`${v} (same chip only)`, `${v} (같은 칩만 가능)`], alts: a, query: v.replace(/\+T10$/, "") };
    }
  }
  return null;
}

export const aliUrl = (q: string) => `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}`;
