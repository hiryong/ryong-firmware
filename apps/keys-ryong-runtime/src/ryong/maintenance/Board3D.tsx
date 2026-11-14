import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { gunzipSync } from "three/examples/jsm/libs/fflate.module.js";
import { t } from "../i18n";
import { aliUrl, buyInfo } from "./partBuy";
import { BOARD3D_SRC, board3dData } from "./board3dData";

// The assembled board in 3D: the bare board from the factory Gerbers (textures), and every part the
// assembler places drawn from its BOM/CPL position and package size (public/board3d/<name>/board.json,
// made by tools/board3d). Parts are simple shapes in the right size, colour and finish, not CAD models.

export interface Part {
  ref: string; value: string; part: string; lcsc: string; footprint: string;
  kind: string; kindName: string; look: string; role: string;
  x: number; y: number; rot: number; side: "top" | "bottom";
  w: number; l: number; h: number; pads: [number, number, number, number][];
  /** footprint origin, local to the part centre (KiCad models are placed from it) */
  origin?: [number, number];
}
interface Hole { x: number; y: number; dx: number; dy: number; rot: number; plated?: boolean; cut?: boolean; r?: number }

/** A hole's outline, local to its centre (KiCad x, y): round, oval (slot), or rounded rectangle (window). */
function holeOutline(h: Hole): [number, number][] {
  const out: [number, number][] = [];
  const arc = (cx: number, cy: number, r: number, a0: number, n: number) => {
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  };
  if (h.cut) {
    const r = Math.min(h.r ?? 0, h.dx / 2, h.dy / 2), x = h.dx / 2 - r, y = h.dy / 2 - r;
    arc(x, y, r, 0, 6); arc(-x, y, r, Math.PI / 2, 6); arc(-x, -y, r, Math.PI, 6); arc(x, -y, r, Math.PI * 1.5, 6);
    return out;
  }
  const r = Math.min(h.dx, h.dy) / 2, n = Math.max(16, Math.min(48, Math.round(r * 16)));
  const ox = h.dx / 2 - r, oy = h.dy / 2 - r; // straight part of a slot
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
    out.push([r * cx + Math.sign(cx) * ox, r * cy + Math.sign(cy) * oy]);
  }
  return out;
}

interface Board {
  name: string; title: string; thickness: number; width: number; height: number;
  outline: [number, number][]; holes?: Hole[]; parts: Part[]; textures: { top: string; bottom: string; topBump?: string; bottomBump?: string };
}

const KIND_EN: Record<string, string> = {
  hotswap: "Hot-swap socket", backlight: "Backlight LED", diode: "Diode", resistor: "Resistor", capacitor: "Capacitor",
  ic: "IC / transistor", led: "Status LED", connector: "Connector", button: "Push button", slide: "Slide switch",
  fuse: "Fuse (PPTC)", inductor: "Inductor", crystal: "Crystal", usb: "USB-C receptacle", module: "Bluetooth module", underglow: "Underglow RGB LED", transistor: "Transistor (MOSFET)", esd: "ESD protection", zener: "Zener diode",
};
const KIND_ROLE: Record<string, [string, string]> = {
  resistor: ["Sets a current or a voltage. Any resistor of the same value and size can replace it.", "전류를 제한하거나 전압을 나눠요. 같은 값·같은 크기 저항이면 교체할 수 있어요."],
  capacitor: ["Keeps the supply steady (decoupling). Same value, size and voltage rating can replace it.", "전원을 안정시켜요(디커플링). 같은 용량·크기·내압이면 교체할 수 있어요."],
};

const mat = (color: string, metal = 0, rough = 0.6, extra: THREE.MeshPhysicalMaterialParameters = {}) =>
  new THREE.MeshPhysicalMaterial({ color, metalness: metal, roughness: rough, ...extra });

function makeMaterials() {
  return {
    black: mat("#1b1b1d", 0, 0.45),
    epoxy: mat("#141416", 0, 0.32, { clearcoat: 0.3 }),
    silver: mat("#d6d7da", 1, 0.28),
    tin: mat("#c4c6c9", 1, 0.38),
    tan: mat("#b79a72", 0, 0.55),
    grey: mat("#55575c", 0, 0.5),
    white: mat("#f3f1ea", 0, 0.4),
    beige: mat("#efe6cf", 0, 0.55),
    socket: mat("#232326", 0, 0.5),
    phosphor: mat("#f4e7a4", 0, 0.3, { emissive: "#3a3000", clearcoat: 1 }),
    redLens: mat("#e0352b", 0, 0.15, { transmission: 0.2, clearcoat: 1, emissive: "#300000" }),
    fuse: mat("#c8a64e", 0, 0.5),
    modulePcb: mat("#1d2733", 0, 0.5),
    stripe: mat("#b9bcc0", 0, 0.5),
    pick: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  };
}
type Mats = ReturnType<typeof makeMaterials>;

/** a box resting on the board at local (cx, cy), local y on the board maps to -Z in the part group */
function box(g: THREE.Group, m: THREE.Material, w: number, l: number, h: number, cx = 0, cy = 0, z0 = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.05), Math.max(h, 0.02), Math.max(l, 0.05)), m);
  mesh.position.set(cx, z0 + h / 2, cy);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  g.add(mesh);
  return mesh;
}

function chip(g: THREE.Group, _M: Mats, p: Part, body: THREE.Material, ends: THREE.Material) {
  const e = Math.min(p.w * 0.2, 0.4);
  box(g, body, p.w - 2 * e, p.l * 0.98, p.h);
  box(g, ends, e, p.l, p.h, -(p.w - e) / 2);
  box(g, ends, e, p.l, p.h, (p.w - e) / 2);
}

function legs(g: THREE.Group, M: Mats, p: Part) {
  // gull-wing leads: a thin strip from the body edge out to each pad that lies outside the body
  for (const [px, py, pw, ph] of p.pads) {
    const outX = Math.abs(px) > p.w / 2 - 0.05, outY = Math.abs(py) > p.l / 2 - 0.05;
    if (!outX && !outY) continue;
    const lw = Math.min(pw, ph, 0.45);
    if (outY) {
      const y0 = Math.sign(py) * (p.l / 2 - 0.2), len = Math.abs(py - y0) + 0.25;
      box(g, M.tin, lw, len, 0.12, px, (y0 + py) / 2 + Math.sign(py) * 0.1);
    } else {
      const x0 = Math.sign(px) * (p.w / 2 - 0.2), len = Math.abs(px - x0) + 0.25;
      box(g, M.tin, len, lw, 0.12, (x0 + px) / 2 + Math.sign(px) * 0.1, py);
    }
  }
}

function buildPart(p: Part, M: Mats): THREE.Group {
  const g = new THREE.Group();
  switch (p.look) {
    case "resistor": chip(g, M, p, M.black, M.tin); box(g, M.grey, (p.w - 0.4) * 0.7, p.l * 0.7, 0.005, 0, 0, p.h); break;
    case "capacitor": chip(g, M, p, M.tan, M.tin); break;
    case "inductor": chip(g, M, p, M.grey, M.tin); break;
    case "fuse": chip(g, M, p, M.fuse, M.tin); break;
    case "backlight": { // reverse-mount 1206: the package lies upside down over the board window, its lens
      // hanging into the window so the light leaves through the switch side. From this side: the LED's
      // white back with its two end terminals; from the switch side: the yellow lens in the window.
      const sub = 0.3;
      box(g, M.white, p.w - 0.7, p.l * 0.98, sub);
      box(g, M.tin, 0.35, p.l, sub + 0.04, -(p.w - 0.35) / 2);
      box(g, M.tin, 0.35, p.l, sub + 0.04, (p.w - 0.35) / 2);
      box(g, M.white, 1.86, 1.5, 0.75, 0, 0, -0.75); // lens body in the window
      box(g, M.phosphor, 1.5, 1.2, 0.02, 0, 0, -0.77); // its light face
      break;
    }
    case "led": chip(g, M, p, M.white, M.tin); box(g, M.redLens, p.w * 0.5, p.l * 0.8, 0.12, 0, 0, p.h); break;
    case "diode": {
      const bw = p.w * 0.62;
      box(g, M.epoxy, bw, p.l * 0.95, p.h);
      box(g, M.stripe, bw * 0.16, p.l * 0.96, 0.01, -bw / 2 + bw * 0.14, 0, p.h); // cathode band
      box(g, M.tin, (p.w - bw) / 2 + 0.05, 0.35, 0.12, -(bw + p.w) / 4);
      box(g, M.tin, (p.w - bw) / 2 + 0.05, 0.35, 0.12, (bw + p.w) / 4);
      break;
    }
    case "ic": {
      const sot = /SOT|TSSOP/.test(p.footprint);
      const bw = sot ? (p.w > p.l ? p.w * 0.95 : p.w * 0.62) : p.w * 0.98;
      const bl = sot ? (p.w > p.l ? p.l * 0.62 : p.l * 0.95) : p.l * 0.98;
      box(g, M.epoxy, bw, bl, p.h, 0, 0, sot ? 0.08 : 0);
      if (sot) legs(g, M, p);
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.01, 16), M.grey);
      dot.position.set(-bw / 2 + 0.35, p.h + (sot ? 0.085 : 0.005), -bl / 2 + 0.35);
      g.add(dot);
      break;
    }
    case "module": {
      box(g, M.modulePcb, p.w * 0.98, p.l * 0.98, 0.8);
      box(g, M.silver, p.w * 0.86, p.l * 0.68, 1.1, 0, p.l * 0.12, 0.8);
      for (const [px, py] of p.pads) box(g, M.tin, 0.6, 0.6, 0.85, px * 0.98, py * 0.98, 0); // castellations
      break;
    }
    case "usb": { // mid-mount receptacle: rounded shell, opening at the board edge (local +y end)
      const s = new THREE.Shape(), w = p.w * 0.98, h = Math.min(p.h, 3.2), r = h / 2;
      s.moveTo(-w / 2 + r, 0); s.lineTo(w / 2 - r, 0); s.absarc(w / 2 - r, r, r, -Math.PI / 2, Math.PI / 2, false);
      s.lineTo(-w / 2 + r, h); s.absarc(-w / 2 + r, r, r, Math.PI / 2, Math.PI * 1.5, false);
      const geo = new THREE.ExtrudeGeometry(s, { depth: p.l * 0.92, bevelEnabled: false, curveSegments: 18 });
      geo.translate(0, 0, -p.l * 0.46);
      const shell = new THREE.Mesh(geo, M.silver); shell.castShadow = true; g.add(shell);
      box(g, M.black, w - 1.2, 0.05, h - 0.9, 0, p.l * 0.46 + 0.01, 0.45);
      box(g, M.black, w * 0.55, 0.6, 0.6, 0, p.l * 0.3, h / 2 - 0.3); // tongue
      break;
    }
    case "connector": { // JST / PicoBlade: natural nylon housing, metal side tabs
      box(g, M.beige, p.w * 0.8, p.l * 0.62, p.h, 0, -p.l * 0.12);
      box(g, M.black, p.w * 0.66, 0.05, p.h * 0.55, 0, -p.l * 0.12 - p.l * 0.31 - 0.01, p.h * 0.25);
      box(g, M.tin, 0.8, 1.3, 1.2, -p.w / 2 + 0.4, -p.l * 0.1);
      box(g, M.tin, 0.8, 1.3, 1.2, p.w / 2 - 0.4, -p.l * 0.1);
      for (const [px, py, pw] of p.pads) if (pw < 1) box(g, M.tin, 0.3, 1.2, 0.12, px, py);
      break;
    }
    case "button": {
      box(g, M.black, p.w * 0.85, p.l * 0.95, 0.7);
      box(g, M.silver, p.w * 0.85, p.l * 0.95, 0.12, 0, 0, 0.7);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.7, 32), M.black);
      cap.position.y = 0.82 + 0.35; cap.castShadow = true; g.add(cap);
      for (const [px, py] of p.pads) box(g, M.tin, 0.7, 0.5, 0.12, px, py);
      break;
    }
    case "slide":
      box(g, M.silver, p.w * 0.72, p.l * 0.62, p.h);
      box(g, M.black, 1.2, 1.4, 0.9, -0.6, -p.l * 0.31 - 0.6, p.h * 0.25);
      for (const [px, py, pw] of p.pads) box(g, M.tin, Math.min(pw, 0.6), 0.6, 0.12, px, py);
      break;
    case "crystal": chip(g, M, p, M.silver, M.tin); break;
    case "hotswap": { // MX socket: two staggered plastic blocks + the two solder tabs
      const [a, b] = p.pads;
      box(g, M.socket, p.w * 0.62, p.l * 0.62, p.h, -p.w * 0.12, -p.l * 0.19);
      box(g, M.socket, p.w * 0.6, p.l * 0.62, p.h, p.w * 0.12, p.l * 0.19);
      if (a) box(g, M.tin, 1.8, 1.7, 0.3, a[0] + Math.sign(a[0]) * 0.1, a[1]);
      if (b) box(g, M.tin, 1.8, 1.7, 0.3, b[0] + Math.sign(b[0]) * 0.1, b[1]);
      break;
    }
    default: box(g, M.grey, p.w, p.l, p.h);
  }
  // an invisible, slightly larger box catches the pointer, so 1 mm parts are easy to hover
  const pick = new THREE.Mesh(new THREE.BoxGeometry(Math.max(p.w, 1.4) + 0.3, Math.max(p.h, 0.6) + 0.3, Math.max(p.l, 1.4) + 0.3), M.pick);
  pick.position.y = p.h / 2;
  pick.name = "pick";
  g.add(pick);
  return g;
}

type ModelEntry = { file: string; refs: string[]; centred?: boolean };
type LoadedMesh = { geo: THREE.BufferGeometry; mat: THREE.Material };

/** A model supplied as glTF binary (tools/board3d/models): metres, y up, x across the part, z = KiCad y,
 *  centred on the part. Each mesh comes back in the part frame in mm with its own material (textures kept). */
async function loadGltf(buf: ArrayBuffer): Promise<{ geo: THREE.BufferGeometry; mat: THREE.Material }[]> {
  const gltf = await new GLTFLoader().parseAsync(buf, "");
  gltf.scene.updateMatrixWorld(true);
  const toMm = new THREE.Matrix4().makeScale(1000, 1000, 1000);
  const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toMm, m.matrixWorld));
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) out.push({ geo, mat });
  });
  return out;
}

/** A part model made by tools/board3d/convert_model.py: one indexed mesh per colour, in the part's own frame.
 *  Stored gzipped (the host does not compress .bin files): about half the download. */
async function loadModel(buf: ArrayBuffer): Promise<{ color: string; geo: THREE.BufferGeometry }[]> {
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    // the browser's own gunzip where it has one (Safari before 16.4 has not): the small bundled one otherwise
    if (typeof DecompressionStream !== "undefined") buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    else { const u = gunzipSync(new Uint8Array(buf)); buf = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; }
  }
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x314d5952) throw new Error("not a RYM1 model"); // "RYM1"
  const jl = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jl))) as { scale: number; groups: { color: string; verts: number; tris: number }[] };
  let o = 8 + jl; o += -o & 3;
  return meta.groups.map((g) => {
    const q = new Int16Array(buf, o, g.verts * 3); o += q.byteLength; o += -o & 3;
    const idx = new Uint16Array(buf, o, g.tris * 3).slice(); o += idx.byteLength; o += -o & 3;
    const pos = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) pos[i] = q[i] * meta.scale;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    return { color: g.color, geo };
  });
}

/** Real part models, by look, for footprints they fit (the rest stay simple shapes). */
/** Model colours → finishes: light greys are plated metal, yellows gold plating, the rest plastic. */
function modelMaterial(color: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255); // sRGB
  const grey = Math.max(r, g, b) - Math.min(r, g, b) < 0.08;
  if (grey && Math.min(r, g, b) > 0.93) return mat("#f2f1ed", 0, 0.45); // white plastic / ceramic
  if (grey && r > 0.35) return mat(r > 0.65 ? "#d3d5d8" : "#c9ccd0", 1, r > 0.65 ? 0.3 : 0.26); // tin / stainless
  if (r > 0.8 && g > 0.65 && b < 0.6) return mat("#d9c47e", 1, 0.3); // gold
  if (grey) return mat("#1c1c1f", 0, 0.5, { clearcoat: 0.15 }); // black plastic
  return mat(color, 0, 0.5);
}

export function partTitle(p: Part) {
  return `${p.ref} · ${p.value}`;
}

export default function Board3D({ src = BOARD3D_SRC }: { src?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<{ p: Part; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<Part | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const api = useRef<{ view: (v: "parts" | "switch" | "reset") => void; mark: (ps: Part[], hover: Part | null) => void; select: (p: Part | null) => void } | null>(null);

  const [partsReady, setPartsReady] = useState(false);
  // board, model list and every model's bytes come from board3dData: already downloading (or done) if the
  // footer link warmed them; the models are turned into meshes here while the board is set up
  const modelsRef = useRef<{ models: ModelEntry[]; loads: Map<string, Promise<LoadedMesh[]>> } | null>(null);
  useEffect(() => {
    setPartsReady(false);
    const d = board3dData(src);
    let live = true;
    // never wait silently: if the data has not come in 25 s, say so (with the reason, for a bug report)
    const late = setTimeout(() => live && setErr(t("The board data did not arrive. Reload the page to try again.", "기판 데이터가 오지 않았어요. 페이지를 새로 고쳐 다시 열어 주세요.")), 25000);
    Promise.all([d.board, d.models]).then(([b, models]) => {
      clearTimeout(late);
      if (!live) return;
      const loads = new Map<string, Promise<LoadedMesh[]>>();
      for (const m of models) {
        const load = d.bytes(m.file).then((buf) => m.file.endsWith(".glb") ? loadGltf(buf) : loadModel(buf).then((ms) => ms.map(({ color, geo }) => ({ geo, mat: modelMaterial(color) as THREE.Material }))));
        load.catch(() => {});
        loads.set(m.file, load);
      }
      modelsRef.current = { models, loads };
      setBoard(b as Board);
    }, (e) => { clearTimeout(late); console.error("board 3D:", e); if (live) setErr(t("Could not load the board.", "기판 데이터를 불러오지 못했어요.") + ` (${e})`); });
    return () => { live = false; clearTimeout(late); };
  }, [src]);

  useEffect(() => {
    const el = host.current;
    if (!board || !el) return;
    const W = board.width, H = board.height, T = board.thickness;
    // phones and tablets get a lighter setup: their browsers (iOS Safari above all) drop a WebGL page
    // that asks for too much graphics memory
    const small = matchMedia("(pointer: coarse)").matches;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setErr(t("This browser can't show 3D (WebGL is off or unavailable).", "이 브라우저에서는 3D를 표시할 수 없어요(WebGL을 쓸 수 없음).")); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
    renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setErr(t("The 3D view was stopped by the browser (graphics memory). Close and open it again.", "브라우저가 3D 화면을 멈췄어요(그래픽 메모리 부족). 닫았다가 다시 열어 주세요.")); });
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c0d0f");
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const sun = new THREE.DirectionalLight("#ffffff", 1.35);
    sun.position.set(-90, 220, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(small ? 2048 : 4096, small ? 2048 : 4096);
    Object.assign(sun.shadow.camera, { left: -W / 2 - 10, right: W / 2 + 10, top: H / 2 + 10, bottom: -H / 2 - 10, near: 10, far: 600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const under = new THREE.DirectionalLight("#ffffff", 0.75);
    under.position.set(60, -200, -80);
    scene.add(under);

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 25;
    controls.maxDistance = 900;
    controls.zoomToCursor = true;

    // ---- the board ----
    const loader = new THREE.TextureLoader();
    const tex = (f: string) => {
      const x = loader.load(src + f, () => (dirty = true));
      x.colorSpace = THREE.SRGBColorSpace;
      x.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return x;
    };
    const pts = board.outline.map(([x, y]) => [x - W / 2, y - H / 2] as const);
    const shapeOf = (flipZ: boolean) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, flipZ ? -z : z)));
    const uvFor = (geo: THREE.BufferGeometry, mirror: boolean) => {
      const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const u = (pos.getX(i) + W / 2) / W;
        uv[i * 2] = mirror ? 1 - u : u;
        uv[i * 2 + 1] = 1 - (pos.getZ(i) + H / 2) / H;
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    };
    // satin solder mask; copper traces, pads and silkscreen stand slightly proud of it (bump map)
    const faceMat = (f: string, bump?: string) => {
      const m = new THREE.MeshPhysicalMaterial({ map: tex(f), alphaTest: 0.5, roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.55 });
      if (bump) { const b = tex(bump); b.colorSpace = THREE.NoColorSpace; m.bumpMap = b; m.bumpScale = 1.6; }
      return m;
    };
    const topGeo = new THREE.ShapeGeometry(shapeOf(true), 1); topGeo.rotateX(-Math.PI / 2); topGeo.translate(0, T, 0); uvFor(topGeo, false);
    const botGeo = new THREE.ShapeGeometry(shapeOf(false), 1); botGeo.rotateX(Math.PI / 2); uvFor(botGeo, true);
    const top = new THREE.Mesh(topGeo, faceMat(board.textures.top, board.textures.topBump)); top.receiveShadow = true;
    const bot = new THREE.Mesh(botGeo, faceMat(board.textures.bottom, board.textures.bottomBump)); bot.receiveShadow = true;
    const sideGeo = new THREE.ExtrudeGeometry(shapeOf(true), { depth: T, bevelEnabled: false, curveSegments: 4 });
    sideGeo.rotateX(-Math.PI / 2);
    const edge = new THREE.Mesh(sideGeo, [new THREE.MeshBasicMaterial({ visible: false }), mat("#e9e6da", 0, 0.7)]);
    const boardG = new THREE.Group();
    boardG.add(top, bot, edge);
    // hole walls: the textures cut the holes; these give them the board's thickness
    // (drilled FR-4 for plain holes and the LED windows, tin for plated holes)
    const wallGeo = (hs: Hole[]) => {
      const pos: number[] = [], idx: number[] = [];
      for (const h of hs) {
        const pts = holeOutline(h);
        const c = Math.cos((h.rot * Math.PI) / 180), sn = Math.sin((h.rot * Math.PI) / 180);
        const base = pos.length / 3;
        for (const [lx, ly] of pts) {
          const x = h.x - W / 2 + lx * c + ly * sn, z = h.y - H / 2 - lx * sn + ly * c;
          pos.push(x, 0, z, x, T, z);
        }
        for (let i = 0; i < pts.length; i++) {
          const a = base + i * 2, b = base + ((i + 1) % pts.length) * 2;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };
    const holes = board.holes ?? [];
    const walls = [
      new THREE.Mesh(wallGeo(holes.filter((h) => !h.plated)), mat("#e6e1cf", 0, 0.8, { side: THREE.DoubleSide })),
      new THREE.Mesh(wallGeo(holes.filter((h) => h.plated)), mat("#d6b56a", 1, 0.3, { side: THREE.DoubleSide })), // ENIG gold plating
    ];
    for (const w of walls) { w.receiveShadow = true; boardG.add(w); }
    // a solid core just inside both faces, with the same holes: where the textures fade out at an edge
    // (the outline, a hole) this shows instead of the dark background, so no black seams
    const coreShape = (flipZ: boolean) => {
      const sh = shapeOf(flipZ);
      for (const h of holes) {
        const c = Math.cos((h.rot * Math.PI) / 180), sn = Math.sin((h.rot * Math.PI) / 180);
        const ring = holeOutline(h).map(([lx, ly]) => {
          const x = h.x - W / 2 + lx * c + ly * sn, z = h.y - H / 2 - lx * sn + ly * c;
          return new THREE.Vector2(x, flipZ ? -z : z);
        });
        sh.holes.push(new THREE.Path(ring));
      }
      return sh;
    };
    const coreMat = mat("#f1f0eb", 0, 0.62); // close to the white mask, so a faded edge reads as board
    const coreTop = new THREE.ShapeGeometry(coreShape(true), 4); coreTop.rotateX(-Math.PI / 2); coreTop.translate(0, T - 0.03, 0);
    const coreBot = new THREE.ShapeGeometry(coreShape(false), 4); coreBot.rotateX(Math.PI / 2); coreBot.translate(0, 0.03, 0);
    for (const g of [coreTop, coreBot]) boardG.add(new THREE.Mesh(g, coreMat));
    scene.add(boardG);

    // ---- parts ----
    const M = makeMaterials();
    const picks: THREE.Object3D[] = [];
    const byPick = new Map<THREE.Object3D, Part>();
    const groups = new Map<Part, THREE.Group>();
    for (const p of board.parts) {
      const g = buildPart(p, M);
      g.position.set(p.x - W / 2, p.side === "top" ? T : 0, p.y - H / 2);
      g.rotation.y = (p.rot * Math.PI) / 180;
      if (p.side === "bottom") g.rotation.z = Math.PI;
      boardG.add(g);
      groups.set(p, g);
      const pick = g.getObjectByName("pick")!;
      picks.push(pick);
      byPick.set(pick, p);
    }

    // real models replace the simple shapes once they arrive (one instanced mesh per colour)
    let alive = true;
    const extraMats: THREE.Material[] = [];
    const instOf = new Map<Part, [THREE.InstancedMesh, number][]>(); // a real-model part's slot in each colour mesh
    // models.json (tools/board3d/fetch_models.py): each model file and the parts placed with it.
    // Parts with a model show nothing until every model has arrived, then all appear at once
    // (no simple stand-in shapes flashing first); a part whose model fails keeps its simple shape.
    const byRef = new Map(board.parts.map((p) => [p.ref, p]));
    const { models, loads } = modelsRef.current ?? { models: [], loads: new Map() };
    const stand = (p: Part, show: boolean) => { for (const c of groups.get(p)!.children) if (c.name !== "pick") c.visible = show; };
    for (const m of models) for (const r of m.refs) { const p = byRef.get(r); if (p) stand(p, false); }
    Promise.allSettled(models.map((m) => loads.get(m.file)!)).then((results) => {
      if (!alive) return;
      results.forEach((res, k) => {
        const m = models[k];
        const ps = m.refs.map((r) => byRef.get(r)).filter((p): p is Part => !!p);
        if (res.status !== "fulfilled") { for (const p of ps) stand(p, true); return; }
        for (const p of ps) { const g = groups.get(p)!; for (const c of [...g.children]) if (c.name !== "pick") g.remove(c); }
        for (const { geo, mat } of res.value) {
          extraMats.push(mat);
          const inst = new THREE.InstancedMesh(geo, mat, ps.length);
          ps.forEach((p, i) => {
            const g = groups.get(p)!; g.updateMatrix();
            const mx = g.matrix.clone();
            // converted models are in footprint coordinates; given ones are centred on the part
            if (p.origin && !m.centred) mx.multiply(new THREE.Matrix4().makeTranslation(p.origin[0], 0, p.origin[1]));
            inst.setMatrixAt(i, mx);
            instOf.set(p, [...(instOf.get(p) ?? []), [inst, i]]);
          });
          inst.castShadow = true; inst.receiveShadow = true;
          boardG.add(inst);
        }
      });
      if (selected && instOf.has(selected)) select(selected);
      setPartsReady(true);
      dirty = true;
    });

    // ---- highlight boxes ----
    const hiMat = new THREE.MeshBasicMaterial({ color: "#2fb6ff", transparent: true, opacity: 0.28, depthWrite: false });
    const hiLine = new THREE.LineBasicMaterial({ color: "#5cc8ff" });
    const kindMat = new THREE.MeshBasicMaterial({ color: "#ffb02e", transparent: true, opacity: 0.35, depthWrite: false });
    const marks = new THREE.Group();
    boardG.add(marks);
    const markOne = (p: Part, m: THREE.Material, outline: boolean) => {
      const g = groups.get(p)!;
      const size = new THREE.Vector3(Math.max(p.w, 0.8) + 0.5, Math.max(p.h, 0.4) + 0.4, Math.max(p.l, 0.8) + 0.5);
      const b = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), m);
      b.position.copy(g.position).add(new THREE.Vector3(0, (p.side === "top" ? 1 : -1) * size.y / 2 - 0.1, 0));
      b.rotation.copy(g.rotation);
      b.renderOrder = 2;
      marks.add(b);
      if (outline) {
        const l = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), hiLine);
        l.position.copy(b.position); l.rotation.copy(b.rotation); marks.add(l);
      }
    };
    const mark = (ps: Part[], h: Part | null) => {
      for (const c of [...marks.children]) { marks.remove(c); (c as THREE.Mesh).geometry.dispose(); }
      for (const p of ps) markOne(p, kindMat, false);
      if (h) markOne(h, hiMat, true);
      dirty = true;
    };

    // ---- camera ----
    // Changing sides turns the board over in place (about the screen's vertical axis, like flipping a
    // real board), instead of flying the camera round to the far side. The camera only eases to the
    // chosen angle, going round the board (spherical) when it has to move far.
    let goal: { a: THREE.Spherical; b: THREE.Spherical; f0: number; f1: number; t0: number } | null = null;
    let flipped = false;
    const fit = () => {
      const a = el.clientWidth / Math.max(el.clientHeight, 1);
      const vfov = (camera.fov * Math.PI) / 180;
      const dW = (W * 1.08) / 2 / Math.tan(Math.atan(Math.tan(vfov / 2) * a));
      const dH = (H * 1.25) / 2 / Math.tan(vfov / 2);
      return Math.max(dW, dH);
    };
    const viewPos = (v: "parts" | "switch" | "reset", d: number) =>
      v === "reset" ? new THREE.Vector3(-d * 0.25, d * 0.82, d * 0.55) : new THREE.Vector3(0, d, 0.001);
    const view = (v: "parts" | "switch" | "reset") => {
      if (v !== "reset") flipped = v === "switch";
      controls.target.set(0, 0, 0);
      const a = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const b = new THREE.Spherical().setFromVector3(viewPos(v, fit()));
      let dt = b.theta - a.theta;
      while (dt > Math.PI) dt -= 2 * Math.PI;
      while (dt < -Math.PI) dt += 2 * Math.PI;
      b.theta = a.theta + dt;
      goal = { a, b, f0: boardG.rotation.z, f1: flipped ? Math.PI : 0, t0: performance.now() };
      dirty = true;
    };
    // ---- selection: everything else dims a little, the chosen part stays lit and slightly brighter ----
    // Drawn in passes: the whole board, a dark veil over it, then the chosen part again on top
    // (same geometry and transform, so it fills exactly its own visible pixels), then the marks.
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.42, depthTest: false, depthWrite: false }));
    const veilCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const selScene = new THREE.Scene();
    selScene.environment = scene.environment;
    selScene.environmentIntensity = scene.environmentIntensity * 1.18;
    for (const l of [sun, under]) { const c = l.clone(); c.castShadow = false; c.intensity *= 1.18; selScene.add(c); }
    let selected: Part | null = null;
    let selPairs: [THREE.Object3D, THREE.Object3D][] = [];
    const select = (p: Part | null) => {
      for (const [c] of selPairs) selScene.remove(c);
      selPairs = [];
      selected = p;
      if (p) {
        for (const o of groups.get(p)!.children) {
          if (o.name === "pick" || !(o as THREE.Mesh).isMesh) continue;
          const c = (o as THREE.Mesh).clone(); c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false;
          selPairs.push([c, o]);
        }
        for (const [inst, i] of instOf.get(p) ?? []) {
          const c = new THREE.InstancedMesh(inst.geometry, inst.material, 1);
          const m = new THREE.Matrix4(); inst.getMatrixAt(i, m); c.setMatrixAt(0, m);
          c.matrixAutoUpdate = false; c.matrixWorldAutoUpdate = false; c.frustumCulled = false;
          selPairs.push([c, inst]);
        }
        for (const [c] of selPairs) selScene.add(c);
      }
      dirty = true;
    };
    const draw = () => {
      if (!selected) { renderer.render(scene, camera); return; }
      marks.visible = false;
      renderer.render(scene, camera);
      marks.visible = true;
      renderer.autoClear = false;
      renderer.render(veil, veilCam);
      for (const [c, o] of selPairs) c.matrixWorld.copy(o.matrixWorld);
      renderer.render(selScene, camera);
      renderer.render(marks, camera);
      renderer.autoClear = true;
    };
    api.current = { view, mark, select };

    // ---- pointer ----
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered: Part | null = null, down = { x: 0, y: 0 };
    const pickAt = (cx: number, cy: number): Part | null => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(picks, false)[0];
      return hit ? byPick.get(hit.object) ?? null : null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const p = pickAt(e.clientX, e.clientY);
      const r = el.getBoundingClientRect();
      if (p !== hovered) { hovered = p; renderer.domElement.style.cursor = p ? "pointer" : ""; onHover(p); }
      setHover(p ? { p, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    };
    const onLeave = () => { hovered = null; onHover(null); setHover(null); };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // a drag, not a click
      const p = pickAt(e.clientX, e.clientY);
      setSel(p);
    };
    let onHover = (_p: Part | null) => {};
    hoverHook.current = (f) => (onHover = f);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    // ---- loop ----
    let dirty = true, raf = 0;
    controls.addEventListener("change", () => (dirty = true));
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = w + "px";
      renderer.domElement.style.height = h + "px";
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const d0 = fit();
    camera.position.copy(viewPos("reset", d0));
    controls.update();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (goal) {
        const k = Math.min(1, (performance.now() - goal.t0) / 700), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const sp = new THREE.Spherical(goal.a.radius + (goal.b.radius - goal.a.radius) * e, goal.a.phi + (goal.b.phi - goal.a.phi) * e, goal.a.theta + (goal.b.theta - goal.a.theta) * e);
        camera.position.setFromSpherical(sp).add(controls.target);
        boardG.rotation.z = goal.f0 + (goal.f1 - goal.f0) * e;
        if (k >= 1) goal = null;
        dirty = true;
      }
      if (controls.update() || dirty) { draw(); dirty = false; }
    };
    tick();
    (el as unknown as { __three?: unknown }).__three = { scene, camera, controls, groups };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      alive = false;
      for (const m of [...Object.values(M), ...extraMats]) m.dispose();
      pm.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
  }, [board, src]);

  // hover → highlight (kept outside the render loop so React state stays the source)
  const hoverHook = useRef<(f: (p: Part | null) => void) => void>(() => {});
  const [hoverPart, setHoverPart] = useState<Part | null>(null);
  useEffect(() => { hoverHook.current((p) => setHoverPart(p)); }, [board]);

  const sameKind = useMemo(() => (board && kind ? board.parts.filter((p) => p.kind === kind) : []), [board, kind]);
  // hover gets the blue box; the selected part is shown by dimming the rest instead
  useEffect(() => { api.current?.mark(sameKind, hoverPart && hoverPart !== sel ? hoverPart : null); }, [sameKind, hoverPart, sel]);
  useEffect(() => { api.current?.select(sel); }, [sel, board]);

  const kinds = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const p of board?.parts ?? []) m.set(p.kind, { name: p.kindName, n: (m.get(p.kind)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [board]);

  const buy = useMemo(() => (sel ? buyInfo(sel) : null), [sel]);
  const same = useMemo(() => (board && sel ? board.parts.filter((p) => (sel.lcsc ? p.lcsc === sel.lcsc : p.value === sel.value)) : []), [board, sel]);

  return (
    <div className="ry-b3">
      <div className="ry-b3-stage" ref={host}>
        {!board && !err && <p className="ry-b3-msg">{t("Loading the board…", "기판을 불러오는 중…")}</p>}
        {err && <p className="ry-b3-msg">{err}</p>}
        {board && !err && !partsReady && <p className="ry-b3-loading" role="status">{t("Loading parts…", "부품 불러오는 중…")}</p>}
        {hover && (
          <div className="ry-b3-tip" style={{ left: hover.x + 14, top: hover.y + 12 }}>
            <strong>{hover.p.ref}</strong> {hover.p.value}
            <span>{t(KIND_EN[hover.p.kind] ?? hover.p.kind, hover.p.kindName)}</span>
          </div>
        )}
        <div className="ry-b3-views">
          <button className="ry-chip" onClick={() => api.current?.view("reset")}>{t("3D", "입체")}</button>
          <button className="ry-chip" onClick={() => api.current?.view("parts")}>{t("Parts side (bottom)", "부품면 (아래쪽)")}</button>
          <button className="ry-chip" onClick={() => api.current?.view("switch")}>{t("Switch side (top)", "스위치면 (위쪽)")}</button>
        </div>
        <p className="ry-b3-hint" data-touch={t("Drag to turn · pinch to zoom", "드래그: 돌리기 · 두 손가락: 확대")}>{t("Drag to turn · scroll to zoom · right-drag to move", "드래그: 돌리기 · 스크롤: 확대 · 오른쪽 드래그: 이동")}</p>
      </div>
      <aside className="ry-b3-side">
        {sel ? (
          <div className="ry-b3-info" aria-live="polite">
            <div className="ry-b3-info-head">
              <span className="ry-faint">{t(KIND_EN[sel.kind] ?? sel.kind, sel.kindName)}</span>
              <button className="ry-text" onClick={() => setSel(null)}>{t("Close", "닫기")}</button>
            </div>
            <h3>{sel.ref}</h3>
            <p className="ry-b3-value">{sel.value}</p>
            <p>{sel.role || t(...(KIND_ROLE[sel.kind] ?? ["", ""]))}</p>
            <dl>
              {sel.part && sel.part !== sel.value && (<><dt>{t("Part", "부품")}</dt><dd>{sel.part}</dd></>)}
              <dt>{t("Package", "패키지")}</dt><dd>{sel.footprint}</dd>
              <dt>{t("Size", "크기")}</dt><dd>{sel.w.toFixed(1)} × {sel.l.toFixed(1)} × {sel.h.toFixed(1)} mm</dd>
              {sel.lcsc && (<><dt>LCSC</dt><dd><a href={`https://www.lcsc.com/product-detail/${sel.lcsc}.html`} target="_blank" rel="noreferrer">{sel.lcsc}</a></dd></>)}
              {buy && (<><dt>{t("Replace with", "대체")}</dt><dd>{t(...buy.spec)}{buy.alts && <span className="ry-b3-alts">{buy.alts.join(" · ")}</span>}{buy.note && <span className="ry-faint ry-b3-alts">{t(...buy.note)}</span>}</dd>
                <dt>{t("Buy", "구매")}</dt><dd><a href={aliUrl(buy.query)} target="_blank" rel="noreferrer">{t("Search AliExpress", "알리익스프레스에서 찾기")}</a></dd></>)}
              <dt>{t("Same part", "같은 부품")}</dt><dd>{same.length > 12 ? t("{n} on the board", "기판에 {n}개", { n: same.length }) : same.map((p) => p.ref).join(", ")}</dd>
            </dl>
          </div>
        ) : (
          <p className="ry-faint">{t("Point at a part to highlight it; click it to see what it is.", "부품에 마우스를 올리면 강조되고, 누르면 어떤 부품인지 보여요.")}</p>
        )}
        <div className="ry-b3-kinds">
          <span className="ry-faint">{t("Show all of a kind", "종류별로 모아 보기")}</span>
          <div>
            {kinds.map(([k, v]) => (
              <button key={k} className="ry-chip" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                {t(KIND_EN[k] ?? k, v.name)} <span className="ry-faint">{v.n}</span>
              </button>
            ))}
          </div>
        </div>
        {board && <p className="ry-faint ry-b3-note">{t("{title} · {w} × {h} mm · {n} parts. Parts are their real 3D models (LCSC/EasyEDA, KiCad library); the Bluetooth module follows its datasheet drawing, resistors are drawn to size.", "{title} · {w} × {h} mm · 부품 {n}개. 부품은 실제 3D 모델(LCSC/EasyEDA, KiCad 라이브러리)이고, 블루투스 모듈은 데이터시트 도면대로, 저항은 크기대로 그린 모양이에요.", { title: board.title, w: board.width.toFixed(1), h: board.height.toFixed(1), n: board.parts.length })}</p>}
      </aside>
    </div>
  );
}
