import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { t } from "../i18n";

// The assembled board in 3D: the bare board from the factory Gerbers (textures), and every part the
// assembler places drawn from its BOM/CPL position and package size (public/board3d/<name>/board.json,
// made by tools/board3d). Parts are simple shapes in the right size, colour and finish, not CAD models.

export interface Part {
  ref: string; value: string; part: string; lcsc: string; footprint: string;
  kind: string; kindName: string; look: string; role: string;
  x: number; y: number; rot: number; side: "top" | "bottom";
  w: number; l: number; h: number; pads: [number, number, number, number][];
}
interface Board {
  name: string; title: string; thickness: number; width: number; height: number;
  outline: [number, number][]; parts: Part[]; textures: { top: string; bottom: string };
}

const KIND_EN: Record<string, string> = {
  hotswap: "Hot-swap socket", backlight: "Backlight LED", diode: "Diode", resistor: "Resistor", capacitor: "Capacitor",
  ic: "IC / transistor", led: "Status LED", connector: "Connector", button: "Push button", slide: "Slide switch",
  fuse: "Fuse (PPTC)", inductor: "Inductor", crystal: "Crystal", usb: "USB-C receptacle", module: "Bluetooth module",
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
    case "backlight": // reverse-mount 1206: white body, yellow phosphor window
      chip(g, M, p, M.white, M.tin);
      box(g, M.phosphor, p.w * 0.36, p.l * 0.62, 0.02, 0, 0, p.h);
      break;
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

export function partTitle(p: Part) {
  return `${p.ref} · ${p.value}`;
}

export default function Board3D({ src = "/board3d/ryong60/" }: { src?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState<{ p: Part; x: number; y: number } | null>(null);
  const [sel, setSel] = useState<Part | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const api = useRef<{ view: (v: "parts" | "switch" | "reset") => void; mark: (ps: Part[], hover: Part | null) => void } | null>(null);

  useEffect(() => {
    fetch(src + "board.json").then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setBoard, () => setErr(t("Could not load the board.", "기판 데이터를 불러오지 못했어요.")));
  }, [src]);

  useEffect(() => {
    const el = host.current;
    if (!board || !el) return;
    const W = board.width, H = board.height, T = board.thickness;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0c0d0f");
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.85;
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-90, 220, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -W / 2 - 10, right: W / 2 + 10, top: H / 2 + 10, bottom: -H / 2 - 10, near: 10, far: 600 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    const under = new THREE.DirectionalLight("#ffffff", 0.9);
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
    const faceMat = (f: string) => new THREE.MeshPhysicalMaterial({ map: tex(f), alphaTest: 0.5, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.4 });
    const topGeo = new THREE.ShapeGeometry(shapeOf(true), 1); topGeo.rotateX(-Math.PI / 2); topGeo.translate(0, T, 0); uvFor(topGeo, false);
    const botGeo = new THREE.ShapeGeometry(shapeOf(false), 1); botGeo.rotateX(Math.PI / 2); uvFor(botGeo, true);
    const top = new THREE.Mesh(topGeo, faceMat(board.textures.top)); top.receiveShadow = true;
    const bot = new THREE.Mesh(botGeo, faceMat(board.textures.bottom)); bot.receiveShadow = true;
    const sideGeo = new THREE.ExtrudeGeometry(shapeOf(true), { depth: T, bevelEnabled: false, curveSegments: 4 });
    sideGeo.rotateX(-Math.PI / 2);
    const edge = new THREE.Mesh(sideGeo, [new THREE.MeshBasicMaterial({ visible: false }), mat("#e9e6da", 0, 0.7)]);
    const boardG = new THREE.Group();
    boardG.add(top, bot, edge);
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
    // camera moves go around the board (spherical), so a turn to the other side never passes through it
    let goal: { a: THREE.Spherical; b: THREE.Spherical; t0: number } | null = null;
    const fit = () => {
      const a = el.clientWidth / Math.max(el.clientHeight, 1);
      const vfov = (camera.fov * Math.PI) / 180;
      const dW = (W * 1.08) / 2 / Math.tan(Math.atan(Math.tan(vfov / 2) * a));
      const dH = (H * 1.25) / 2 / Math.tan(vfov / 2);
      return Math.max(dW, dH);
    };
    const viewPos = (v: "parts" | "switch" | "reset", d: number) =>
      v === "switch" ? new THREE.Vector3(0, -d * 0.97, -d * 0.24) // from below, board y up the screen, so it reads mirrored like the real switch side
      : v === "parts" ? new THREE.Vector3(0, d, 0.001)
      : new THREE.Vector3(-d * 0.25, d * 0.82, d * 0.55);
    const view = (v: "parts" | "switch" | "reset") => {
      controls.target.set(0, 0, 0);
      const a = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const b = new THREE.Spherical().setFromVector3(viewPos(v, fit()));
      let dt = b.theta - a.theta;
      while (dt > Math.PI) dt -= 2 * Math.PI;
      while (dt < -Math.PI) dt += 2 * Math.PI;
      b.theta = a.theta + dt;
      goal = { a, b, t0: performance.now() };
      dirty = true;
    };
    api.current = { view, mark };

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
        const k = Math.min(1, (performance.now() - goal.t0) / 650), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const sp = new THREE.Spherical(goal.a.radius + (goal.b.radius - goal.a.radius) * e, goal.a.phi + (goal.b.phi - goal.a.phi) * e, goal.a.theta + (goal.b.theta - goal.a.theta) * e);
        camera.position.setFromSpherical(sp).add(controls.target);
        if (k >= 1) goal = null;
        dirty = true;
      }
      if (controls.update() || dirty) { renderer.render(scene, camera); dirty = false; }
    };
    tick();
    (el as unknown as { __three?: unknown }).__three = { scene, camera, controls, groups };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
      for (const m of Object.values(M)) m.dispose();
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
  useEffect(() => { api.current?.mark(sameKind, hoverPart ?? sel); }, [sameKind, hoverPart, sel]);

  const kinds = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const p of board?.parts ?? []) m.set(p.kind, { name: p.kindName, n: (m.get(p.kind)?.n ?? 0) + 1 });
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [board]);

  const same = useMemo(() => (board && sel ? board.parts.filter((p) => (sel.lcsc ? p.lcsc === sel.lcsc : p.value === sel.value)) : []), [board, sel]);

  return (
    <div className="ry-b3">
      <div className="ry-b3-stage" ref={host}>
        {!board && !err && <p className="ry-b3-msg">{t("Loading the board…", "기판을 불러오는 중…")}</p>}
        {err && <p className="ry-b3-msg">{err}</p>}
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
        {board && <p className="ry-faint ry-b3-note">{t("{title} · {w} × {h} mm · {n} parts. Parts are drawn to size from the assembly data, not exact CAD models.", "{title} · {w} × {h} mm · 부품 {n}개. 조립 데이터의 위치·크기로 그린 모양이라 실제 부품 모델과 세부는 달라요.", { title: board.title, w: board.width.toFixed(1), h: board.height.toFixed(1), n: board.parts.length })}</p>}
      </aside>
    </div>
  );
}
