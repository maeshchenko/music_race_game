import * as THREE from 'three';
import { buildCar } from './car';
import { halfWidth, HALF_WIDE, LANE_DIVIDER } from './road';
import { IS_MOBILE } from '../platform';

/**
 * Вечерняя провинция: дорога, панельки с тёплыми окнами, натриевые фонари,
 * снег. Мир — «беговая дорожка» из чанков: машина едет в -z, чанки позади
 * переезжают вперёд. Вся геометрия следует рельефу heightAt(z) из музыки.
 *
 * РЕНДЕР: весь повторяющийся декор (разметка, фонари, деревья, дома, гаражи,
 * киоски, сугробы) живёт в пулах InstancedMesh — один draw call на тип на ВСЕ
 * чанки вместо тысячи отдельных мешей. Машины/остановки — пул переиспользуемых
 * групп. Переезд чанка (recycle) только ПЕРЕПИСЫВАЕТ матрицы инстансов своего
 * слота — ноль аллокаций/dispose в кадре (был GC-спайк → подвисания).
 */

const CHUNK_LEN = 60;
const CHUNKS = IS_MOBILE ? 8 : 13; // мобайл — короче улица (меньше инстансов/тумана)
const LAMP_SPACING = 20;
const ROAD_W = HALF_WIDE * 2; // полная ширина полотна (3 полосы); 2-полосный режим ужимает его
const POOLED_LIGHTS = IS_MOBILE ? 2 : 4;

/** Высота мира в точке z (мировая координата, вперёд = -z). */
export type HeightFn = (z: number) => number;
/** Боковое смещение оси дороги в точке z — повороты. */
export type CurveFn = (z: number) => number;

/**
 * Тема заезда: палитра неба и фонарей + погода. Новизна каждый заезд —
 * дофаминергична для СДВГ. Цвета фонарей держим тёплыми/холодно-белыми,
 * чтобы не конфликтовать с сигнальными цветами блоков (cyan/magenta/lime).
 */
export interface WorldTheme {
  name: string;
  fog: number; // цвет тумана и фона
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity?: number; // яркость неба: ночь ~1.0, рассвет/закат выше
  lamp: number; // фонари: головка, конус, пятно, прожектор
  precip: 'snow' | 'rain' | 'clear';
  precipColor: number;
}

export const THEMES: WorldTheme[] = [
  { name: 'снежная ночь', fog: 0x252834, fogNear: 25, fogFar: 230,
    hemiSky: 0x5a648a, hemiGround: 0x1c1c24, lamp: 0xffa54d, precip: 'snow', precipColor: 0xd6dbe4 },
  { name: 'ясная ночь', fog: 0x10131f, fogNear: 35, fogFar: 320,
    hemiSky: 0x46506e, hemiGround: 0x14141c, lamp: 0xffb060, precip: 'clear', precipColor: 0xd6dbe4 },
  { name: 'туман', fog: 0x2b2e35, fogNear: 14, fogFar: 150,
    hemiSky: 0x6a6e7a, hemiGround: 0x24262b, lamp: 0xe8dcc0, precip: 'snow', precipColor: 0xc8cdd6 },
  { name: 'дождь', fog: 0x1a1e26, fogNear: 20, fogFar: 200,
    hemiSky: 0x49526a, hemiGround: 0x181a22, lamp: 0xffc070, precip: 'rain', precipColor: 0x9fb0c8 },
  { name: 'морозная синь', fog: 0x1a2230, fogNear: 28, fogFar: 250,
    hemiSky: 0x4a6088, hemiGround: 0x16202c, lamp: 0xcfe0ff, precip: 'snow', precipColor: 0xe6eeff },
  { name: 'розовый вечер', fog: 0x2a2230, fogNear: 26, fogFar: 240,
    hemiSky: 0x6a5074, hemiGround: 0x201824, lamp: 0xffb890, precip: 'clear', precipColor: 0xe8d6e0 },
  { name: 'рассвет', fog: 0x6a6e84, fogNear: 30, fogFar: 300,
    hemiSky: 0x9aa6c4, hemiGround: 0x6a6458, hemiIntensity: 1.7, lamp: 0xffcaa0,
    precip: 'clear', precipColor: 0xdfe4ee },
  { name: 'закат', fog: 0x6e4a4a, fogNear: 28, fogFar: 280,
    hemiSky: 0xc08868, hemiGround: 0x5a3a3a, hemiIntensity: 1.6, lamp: 0xffb060,
    precip: 'clear', precipColor: 0xeed6c8 },
  { name: 'хмурое утро', fog: 0x5a5e66, fogNear: 22, fogFar: 200,
    hemiSky: 0x8a909c, hemiGround: 0x56585e, hemiIntensity: 1.5, lamp: 0xe8dcc0,
    precip: 'rain', precipColor: 0xb6bcc8 },
];

export const pickTheme = (): WorldTheme => THEMES[Math.floor(Math.random() * THEMES.length)];

/**
 * Биом-сет: какие здания и как часто какой декор. Ротация биомов (через новизну
 * #36) меняет облик улицы глубже простого свопа палитры — против однообразия.
 * kinds — индексы в World.kinds: 0 хрущёвка,1 панелька,2 длинная,3 свечка,
 * 4 высотка,5 ТЦ,6 промздание.
 */
export interface Biome {
  name: string;
  kinds: number[];
  tree: number; fir: number; billboard: number;
  garage: number; kiosk: number; stop: number; parked: number; bridge: number;
  /** Плотность застройки: 1 — дома плотно вдоль дороги; <1 — редкие дома, между
   *  ними открытое поле (большие просветы). По умолчанию 1. */
  build?: number;
  /** Разрешить высотные дома (kinds 4/5) — для городского/шоссе-биома. */
  urban?: boolean;
  /** Разметка на 3 полосы (доп. пунктиры-разделители) — для шоссе. */
  lanes?: boolean;
}
export const BIOMES: Biome[] = [
  { name: 'спальный район', kinds: [0, 1, 2, 3], tree: 0.55, fir: 0.55, billboard: 0.25, garage: 0.4, kiosk: 0.3, stop: 0.3, parked: 0.55, bridge: 0.15 },
  { name: 'центр', kinds: [1, 2, 3, 4, 5], tree: 0.2, fir: 0.3, billboard: 0.7, garage: 0.1, kiosk: 0.45, stop: 0.4, parked: 0.6, bridge: 0.28 },
  { name: 'промзона', kinds: [6, 2, 0, 6], tree: 0.18, fir: 0.2, billboard: 0.3, garage: 0.65, kiosk: 0.15, stop: 0.15, parked: 0.4, bridge: 0.22 },
  { name: 'окраина', kinds: [0, 1], tree: 0.85, fir: 0.8, billboard: 0.08, garage: 0.25, kiosk: 0.15, stop: 0.2, parked: 0.3, bridge: 0.1 },
  // поле: открытый простор — густые деревья, фонари вдоль дороги, лишь редкие
  // кубики-пятиэтажки с тёплыми окнами далеко друг от друга.
  { name: 'поле', kinds: [7, 7, 8], tree: 0.95, fir: 0.7, billboard: 0, garage: 0.12, kiosk: 0.1, stop: 0.15, parked: 0.2, bridge: 0, build: 0.045 },
  // шоссе: трёхполосная разметка, плотная городская застройка — высотки (4)
  // вперемешку с панельками (1,2) и свечками (3).
  { name: 'шоссе', kinds: [1, 2, 3, 4, 1, 2], tree: 0.25, fir: 0.2, billboard: 0, garage: 0.2, kiosk: 0.3, stop: 0.3, parked: 0.7, bridge: 0, urban: true, lanes: true },
];

/**
 * Район по типу дороги (см. road.ts districtAt): 0 провинция (база), 1 поле,
 * 2 город (+шоссе, 3 полосы). Это и есть «районы» — застройка задаётся типом,
 * а не случайной ротацией. kinds — индексы в World.kinds (0..8).
 */
interface District {
  kinds: number[]; tree: number; fir: number;
  garage: number; kiosk: number; stop: number; parked: number; build: number;
}
const DISTRICTS: District[] = [
  // 0 ПРОВИНЦИЯ (база): хрущёвки/панельки/свечки, дворы, деревья
  { kinds: [0, 1, 2, 3], tree: 0.55, fir: 0.55, garage: 0.4, kiosk: 0.3, stop: 0.3, parked: 0.55, build: 1 },
  // 1 ПОЛЕ: редкие будки-кубики, густые ёлки, простор
  { kinds: [7, 7, 8], tree: 0.95, fir: 0.7, garage: 0.12, kiosk: 0.1, stop: 0.15, parked: 0.2, build: 0.045 },
  // 2 ГОРОД (+шоссе/3 полосы): высотки (4) вперемешку с панельками/свечками
  { kinds: [1, 2, 3, 4], tree: 0.2, fir: 0.2, garage: 0.15, kiosk: 0.35, stop: 0.35, parked: 0.7, build: 1 },
];

// --- процедурная текстура панельки --------------------------------------

interface BuildingKind {
  w: number; h: number; d: number;
  mats: THREE.Material[];
  sink: number; // насколько утоплен в рельеф (большие дома ~1м; будка — 0, стоит на земле)
}

function panelTextures(
  floors: number, cols: number, base: string, lit: number,
): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const W = 128, H = floors * 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const e = document.createElement('canvas');
  e.width = W; e.height = H;
  const ge = e.getContext('2d')!;

  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // панельные швы
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let f = 0; f <= floors; f++) {
    g.beginPath(); g.moveTo(0, f * 32); g.lineTo(W, f * 32); g.stroke();
  }
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);

  const cw = W / cols;
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < cols; i++) {
      const x = i * cw + cw * 0.25, y = f * 32 + 9, w = cw * 0.5, h = 15;
      if (Math.random() < lit) {
        const warm = Math.random() < 0.8 ? '#ffb866' : '#ffe9c0';
        g.fillStyle = warm;
        g.fillRect(x, y, w, h);
        ge.fillStyle = warm;
        ge.fillRect(x, y, w, h);
      } else {
        g.fillStyle = '#0d1016';
        g.fillRect(x, y, w, h);
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  const emissiveMap = new THREE.CanvasTexture(e);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

function buildingKind(
  w: number, h: number, d: number, floors: number, cols: number, base: string, lit = 0.28, sink = 1,
): BuildingKind {
  const { map, emissiveMap } = panelTextures(floors, cols, base, lit);
  const side = new THREE.MeshLambertMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.9,
  });
  const roof = new THREE.MeshLambertMaterial({ color: 0x23252b });
  // порядок граней BoxGeometry: +x -x +y -y +z -z
  return { w, h, d, mats: [side, side, roof, roof, side, side], sink };
}

/** Радиальный тёплый градиент — имитация блика фонаря на мокром асфальте. */
function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 3, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255, 200, 130, 0.55)');
  grad.addColorStop(0.35, 'rgba(255, 165, 77, 0.28)');
  grad.addColorStop(0.7, 'rgba(255, 150, 60, 0.10)');
  grad.addColorStop(1, 'rgba(255, 150, 60, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- пулы инстансов -------------------------------------------------------
// общие скретч-объекты композиции матрицы — без аллокаций в кадре/при recycle
const _m4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _eul = new THREE.Euler();
const _col = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0); // нулевой масштаб = инстанс не виден

/**
 * Пул одинаковых мешей одним InstancedMesh. Слоты нарезаны по чанкам:
 * чанк со слотом `s` владеет инстансами [s*perChunk, (s+1)*perChunk). recycle
 * перезаписывает ТОЛЬКО свой диапазон — без создания/уничтожения объектов.
 */
class InstancePool {
  readonly mesh: THREE.InstancedMesh;
  readonly perChunk: number;
  private dirty = false;

  constructor(
    geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[],
    perChunk: number, chunks: number, scene: THREE.Scene, colored = false,
  ) {
    this.perChunk = perChunk;
    const cap = perChunk * chunks;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.frustumCulled = false; // инстансы раскиданы по всей улице
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, HIDDEN);
    if (colored) {
      this.mesh.setColorAt(0, _col.setHex(0xffffff));
      for (let i = 1; i < cap; i++) this.mesh.setColorAt(i, _col);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  set(slot: number, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, colorHex?: number, rx = 0) {
    _pos.set(x, y, z);
    _eul.set(rx, ry, 0);
    _quat.setFromEuler(_eul);
    _scl.set(sx, sy, sz);
    this.mesh.setMatrixAt(slot, _m4.compose(_pos, _quat, _scl));
    if (colorHex !== undefined) this.mesh.setColorAt(slot, _col.setHex(colorHex));
    this.dirty = true;
  }

  hide(slot: number) { this.mesh.setMatrixAt(slot, HIDDEN); this.dirty = true; }

  flush() {
    if (!this.dirty) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

/**
 * Пул переиспользуемых групп (машины, остановки): сложно инстансить
 * (мульти-материал + спрайты), но переиспользовать — легко. Строим один раз,
 * далее только репозиционируем и прячем. Ноль аллокаций при recycle.
 */
class GroupPool {
  readonly perChunk: number;
  private groups: THREE.Group[] = [];
  constructor(make: () => THREE.Group, perChunk: number, chunks: number, scene: THREE.Scene) {
    this.perChunk = perChunk;
    for (let i = 0; i < perChunk * chunks; i++) {
      const g = make();
      g.visible = false;
      scene.add(g);
      this.groups.push(g);
    }
  }
  at(slot: number, c: number): THREE.Group { return this.groups[slot * this.perChunk + c]; }
  dispose() {
    for (const g of this.groups) g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
  }
}

/**
 * Полосы дороги/земли/обочин/тротуаров — длинные кривые полотна, следуют
 * рельефу (hAt/cAt вшиты в вершины), инстансить нельзя. Но переиспользовать —
 * можно: один меш на слот-чанк, при recycle ПЕРЕЗАПИСЫВАЕМ вершины на месте
 * (тот же Float32Array), без аллокации геометрии/меша. Было: каждый recycle
 * создавал новые PlaneGeometry + computeVertexNormals для всех полос = спайк.
 */
interface StripDef {
  w: number; mat: THREE.Material; yOff: number; segs: number;
  role: 'ground' | 'road' | 'edge';
  side?: -1 | 1;    // сторона дороги (для edge — обочина/тротуар)
  edgeOff?: number; // смещение центра полосы от кромки проезжей части
}
const STRIP_ZMID = -CHUNK_LEN / 2;
const ROAD_HALF = ROAD_W / 2; // базовая полуширина дорожной геометрии (= halfWidth(1))
class StripPool {
  private meshes: THREE.Mesh[][] = []; // [slot][stripIdx]
  private xs: Float32Array[] = [];     // базовый X вершин на тип полосы
  private zs: Float32Array[] = [];     // локальный Z вершин на тип полосы
  constructor(
    private defs: StripDef[], chunks: number, scene: THREE.Scene,
    private hAt: HeightFn, private cAt: CurveFn, private wAt: (z: number) => number,
  ) {
    for (let d = 0; d < defs.length; d++) {
      const g = new THREE.PlaneGeometry(defs[d].w, CHUNK_LEN, 1, defs[d].segs);
      g.rotateX(-Math.PI / 2);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const xs = new Float32Array(p.count), zs = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) { xs[i] = p.getX(i); zs[i] = p.getZ(i); }
      this.xs.push(xs); this.zs.push(zs);
      g.dispose(); // шаблон не нужен — клонируем геометрию на каждый слот
    }
    for (let s = 0; s < chunks; s++) {
      const row: THREE.Mesh[] = [];
      for (let d = 0; d < defs.length; d++) {
        const geo = new THREE.PlaneGeometry(defs[d].w, CHUNK_LEN, 1, defs[d].segs);
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, defs[d].mat);
        m.frustumCulled = false;
        scene.add(m);
        row.push(m);
      }
      this.meshes.push(row);
    }
  }
  write(slot: number, chunkZ: number) {
    const zc = chunkZ + STRIP_ZMID;
    const row = this.meshes[slot];
    for (let d = 0; d < this.defs.length; d++) {
      const def = this.defs[d];
      const m = row[d];
      const p = m.geometry.getAttribute('position') as THREE.BufferAttribute;
      const xs = this.xs[d], zs = this.zs[d];
      for (let i = 0; i < p.count; i++) {
        const wz = zc + zs[i];
        const hw = halfWidth(this.wAt(wz)); // текущая полуширина проезжей части
        let x = this.cAt(wz);
        if (def.role === 'road') x += xs[i] * (hw / ROAD_HALF); // полотно сужается/расширяется
        else if (def.role === 'edge') x += xs[i] + def.side! * (hw + def.edgeOff!); // обочина/тротуар у кромки
        else x += xs[i]; // земля — без изменения ширины
        p.setY(i, this.hAt(wz) + def.yOff);
        p.setX(i, x);
      }
      p.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.position.set(0, 0, zc);
    }
  }
  dispose() {
    for (const row of this.meshes) for (const m of row) m.geometry.dispose();
  }
}

// --- чанк улицы -----------------------------------------------------------

interface Chunk {
  /** Индекс чанка по дороге (z = -index * CHUNK_LEN). */
  index: number;
  /** Физический слот 0..CHUNKS-1 — диапазон инстансов в каждом пуле (не меняется). */
  slot: number;
  lampHeads: THREE.Vector3[]; // МИРОВЫЕ позиции головок для пула света
}

export class World {
  readonly scene = new THREE.Scene();
  private chunks: Chunk[] = [];
  private kinds: BuildingKind[];
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // матовый асфальт: specular-блик фонарей ездил бы за камерой,
  // «мокрое» пятно рисуем glow-текстурой строго под фонарём
  private roadMat = new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.85, metalness: 0.04 });
  private groundMat = new THREE.MeshLambertMaterial({ color: 0x17181d });
  private shoulderMat = new THREE.MeshLambertMaterial({ color: 0x3a3835 });
  private sidewalkMat = new THREE.MeshLambertMaterial({ color: 0x2c2d31 });
  private snowPatchMat = new THREE.MeshLambertMaterial({ color: 0x8d949e });
  private lineMat = new THREE.MeshBasicMaterial({ color: 0xb8bcc4, transparent: true, opacity: 0.32 });
  private poleMat = new THREE.MeshLambertMaterial({ color: 0x33363c });
  private lampHeadMat = new THREE.MeshStandardMaterial({
    color: 0xffa54d, emissive: 0xffa54d, emissiveIntensity: 2.5,
  });
  private coneMat = new THREE.MeshBasicMaterial({
    color: 0xffa54d, transparent: true, opacity: 0.07,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  private theme: WorldTheme;
  private poolMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(), transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  private poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6);
  private headGeo = new THREE.BoxGeometry(0.5, 0.16, 0.22);
  private coneGeo = new THREE.ConeGeometry(2.6, 4.8, 12, 1, true);
  // плоские, прижатые к земле геометрии для инстансов (рельеф снимаем позицией)
  private lineGeo = (() => { const g = new THREE.PlaneGeometry(0.14, 2.6); g.rotateX(-Math.PI / 2); return g; })();
  private glowGeo = (() => { const g = new THREE.PlaneGeometry(8.5, 11); g.rotateX(-Math.PI / 2); return g; })();
  private patchGeo = (() => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; })();
  // зимний двор: ели, голые деревья, гаражи, киоски
  private firGeo = new THREE.ConeGeometry(1.5, 3.6, 7);
  private firMat = new THREE.MeshLambertMaterial({ color: 0x1d2b22 });
  private firSnowGeo = new THREE.ConeGeometry(1.1, 1.6, 7);
  private firSnowMat = new THREE.MeshLambertMaterial({ color: 0x77808c });
  private trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 2.4, 5);
  private trunkMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });
  private crownGeo = new THREE.IcosahedronGeometry(1.1, 0);
  private crownMat = new THREE.MeshLambertMaterial({ color: 0x191d1a });
  private garageGeo = new THREE.BoxGeometry(3.4, 2.6, 6.2);
  private garageMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); // цвет — per-instance
  private garageDoorGeo = new THREE.PlaneGeometry(2.6, 2.1);
  private garageDoorMat = new THREE.MeshLambertMaterial({ color: 0x2e2c29 });
  private kioskGeo = new THREE.BoxGeometry(2.6, 2.4, 2.2);
  private kioskMat = new THREE.MeshLambertMaterial({ color: 0x42403a });
  private kioskWinGeo = new THREE.PlaneGeometry(1.7, 0.9);
  private kioskWinMat = new THREE.MeshStandardMaterial({
    color: 0xffd9a0, emissive: 0xffc070, emissiveIntensity: 1.6,
  });
  private stopWallMat = new THREE.MeshLambertMaterial({ color: 0x3b3e44 });
  private stopLightMat = new THREE.MeshStandardMaterial({
    color: 0xdfe8ff, emissive: 0xbcd0ff, emissiveIntensity: 1.1,
  });
  private vazColors = [0x6b1220, 0x8a8576, 0x2c3e5c, 0x9aa0a8, 0x2f4a38];
  private garageColors = [0x4a4440, 0x3f4a44, 0x54504a, 0x44424c];
  // пулы инстансов и групп
  private pools: InstancePool[] = [];
  private pLine!: InstancePool; private pPole!: InstancePool; private pHead!: InstancePool;
  private pCone!: InstancePool; private pGlow!: InstancePool; private pPatch!: InstancePool;
  private pFir!: InstancePool; private pFirSnow!: InstancePool;
  private pTrunk!: InstancePool; private pCrown!: InstancePool;
  private pGarage!: InstancePool; private pGarageDoor!: InstancePool;
  private pKiosk!: InstancePool; private pKioskWin!: InstancePool;
  private pBuild!: InstancePool[]; // по виду дома
  private gCar!: GroupPool; private gStop!: GroupPool;
  private strips!: StripPool; // дорога/земля/обочины/тротуары
  private pooled: THREE.SpotLight[] = [];
  // переиспользуемый пул позиций ближних фонарей — без аллокаций/sort в кадре
  private headPool: THREE.Vector3[] = [];
  private headUsed: boolean[] = [];
  private snow: THREE.Points | null = null;
  private snowVel: Float32Array = new Float32Array(0);
  private SNOW_N: number;
  private readonly SNOW_BOX = new THREE.Vector3(50, 22, 70);
  private hemi: THREE.HemisphereLight;
  // #16 материалы, пульсирующие по биту (эмиссив окон/фонарей, ореолы)
  private pulseTargets!: { mat: THREE.Material; prop: string; base: number; amp: number }[];

  constructor(
    private hAt: HeightFn = () => 0,
    private cAt: CurveFn = () => 0,
    private wAt: (z: number) => number = () => 0, // полосность дороги (0 — 2 полосы, 1 — 3)
    private dAt: (z: number) => number = () => 0, // тип района (0 провинция, 1 поле, 2 город)
    theme: WorldTheme = THEMES[0],
  ) {
    this.theme = theme;

    const base = IS_MOBILE ? 700 : 1600;
    this.SNOW_N = theme.precip === 'clear' ? Math.round(base * 0.25) : base;

    this.scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    this.scene.background = new THREE.Color(theme.fog);

    this.hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 1.0);
    this.scene.add(this.hemi);
    const moon = new THREE.DirectionalLight(0x8a96b8, 0.45);
    moon.position.set(-30, 60, -20);
    this.scene.add(moon);

    this.applyTheme(theme); // цвета фонарей/неба, без пересборки чанков

    this.kinds = [
      buildingKind(22, 15, 12, 5, 8, '#4a4742'), // хрущёвка 5 эт.
      buildingKind(15, 27, 12, 9, 5, '#474c54'), // панелька 9 эт.
      buildingKind(28, 27, 12, 9, 10, '#52504c'), // длинная 9 эт.
      buildingKind(13, 36, 13, 12, 4, '#41464f'), // свечка 12 эт.
      buildingKind(16, 54, 16, 18, 5, '#3c4048', 0.34), // высотка 18 эт.
      buildingKind(34, 12, 22, 3, 14, '#54514a', 0.5), // ТЦ — широкий, ярко горит
      buildingKind(24, 18, 20, 4, 6, '#3a3833', 0.12), // промздание — тёмное, редкие окна
      buildingKind(2.6, 2.6, 2.6, 1, 1, '#3f3b36', 1.0, 0), // 7 будка-кубик: окошко горит (для поля)
      buildingKind(2.6, 2.6, 2.6, 1, 1, '#3f3b36', 0.0, 0), // 8 будка-кубик: окошко потушено
    ];

    // --- создаём пулы инстансов (один draw call на тип на ВСЕ чанки) ---
    const C = CHUNKS;
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], per: number, colored = false) => {
      const p = new InstancePool(geo, mat, per, C, this.scene, colored);
      this.pools.push(p);
      return p;
    };
    this.pLine = mk(this.lineGeo, this.lineMat, 30); // центр + 2 разделителя полос (шоссе)
    this.pPole = mk(this.poleGeo, this.poleMat, 4);
    this.pHead = mk(this.headGeo, this.lampHeadMat, 4);
    this.pCone = mk(this.coneGeo, this.coneMat, 4);
    this.pGlow = mk(this.glowGeo, this.poolMat, 4);
    this.pPatch = mk(this.patchGeo, this.snowPatchMat, 8);
    this.pFir = mk(this.firGeo, this.firMat, 12);
    this.pFirSnow = mk(this.firSnowGeo, this.firSnowMat, 12);
    this.pTrunk = mk(this.trunkGeo, this.trunkMat, 12);
    this.pCrown = mk(this.crownGeo, this.crownMat, 12);
    this.pGarage = mk(this.garageGeo, this.garageMat, 6, true);
    this.pGarageDoor = mk(this.garageDoorGeo, this.garageDoorMat, 6);
    this.pKiosk = mk(this.kioskGeo, this.kioskMat, 2);
    this.pKioskWin = mk(this.kioskWinGeo, this.kioskWinMat, 2);
    this.pBuild = this.kinds.map((k) => mk(this.boxGeo, k.mats, 10));
    this.gCar = new GroupPool(
      () => buildCar({ color: this.vazColors[Math.floor(Math.random() * this.vazColors.length)], lightsOn: false }),
      2, C, this.scene,
    );
    this.gStop = new GroupPool(() => this.makeStop(), 1, C, this.scene);
    this.strips = new StripPool([
      { w: 500, mat: this.groundMat, yOff: -0.14, segs: 16, role: 'ground' }, // земля до домов
      { w: ROAD_W, mat: this.roadMat, yOff: 0, segs: 16, role: 'road' }, // полотно — ширина по wAt
      { w: 2.4, mat: this.shoulderMat, yOff: 0.012, segs: 16, role: 'edge', side: -1, edgeOff: 1.2 },
      { w: 2.4, mat: this.shoulderMat, yOff: 0.012, segs: 16, role: 'edge', side: 1, edgeOff: 1.2 },
      { w: 3.4, mat: this.sidewalkMat, yOff: 0.06, segs: 16, role: 'edge', side: -1, edgeOff: 4.1 },
      { w: 3.4, mat: this.sidewalkMat, yOff: 0.06, segs: 16, role: 'edge', side: 1, edgeOff: 4.1 },
    ], C, this.scene, this.hAt, this.cAt, this.wAt);

    for (let i = 0; i < POOLED_LIGHTS; i++) {
      // конус вниз, угол как у видимого плафона: atan(2.6 / 4.8) ≈ 0.5 рад —
      // машина освещается только когда реально въезжает в пятно фонаря
      const l = new THREE.SpotLight(theme.lamp, 70, 14, 0.52, 0.55, 1.2);
      this.scene.add(l, l.target);
      this.pooled.push(l);
    }

    // #16 бит-пульс мира: эмиссивы/ореолы «дышат» на каждую долю → ритм-транс.
    // Собираем целевые материалы и их базовые значения один раз.
    this.pulseTargets = [
      { mat: this.lampHeadMat, prop: 'emissiveIntensity', base: this.lampHeadMat.emissiveIntensity, amp: 0.5 },
      { mat: this.kioskWinMat, prop: 'emissiveIntensity', base: this.kioskWinMat.emissiveIntensity, amp: 0.5 },
      { mat: this.stopLightMat, prop: 'emissiveIntensity', base: this.stopLightMat.emissiveIntensity, amp: 0.5 },
      { mat: this.coneMat, prop: 'opacity', base: this.coneMat.opacity, amp: 0.8 },
      { mat: this.poolMat, prop: 'opacity', base: this.poolMat.opacity, amp: 0.45 },
      ...this.kinds.map((k) => {
        const side = k.mats[0] as THREE.MeshLambertMaterial;
        return { mat: side, prop: 'emissiveIntensity' as const, base: side.emissiveIntensity, amp: 0.4 };
      }),
    ];

    for (let i = 0; i < CHUNKS; i++) {
      const c: Chunk = { index: i, slot: i, lampHeads: [] };
      this.writeChunk(c);
      this.chunks.push(c);
    }
    for (const p of this.pools) p.flush();

    this.buildSnow();
  }

  /** Остановка: задняя стенка, крыша, лавка, холодная лампа (общие материалы). */
  private makeStop(): THREE.Group {
    const stop = new THREE.Group();
    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 2.0, 0.14), this.stopWallMat);
    back.position.set(0, 1.2, 0.7);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 1.8), this.stopWallMat);
    roof.position.set(0, 2.25, 0);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.09, 0.5), this.stopWallMat);
    bench.position.set(0, 0.55, 0.45);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.2), this.stopLightMat);
    lamp.position.set(0, 2.16, 0);
    stop.add(back, roof, bench, lamp);
    return stop;
  }

  /** Пульс эмиссивов по доле (env 0..1) — окна/фонари «дышат» в бит. */
  private pulse(env: number) {
    for (const t of this.pulseTargets) {
      (t.mat as unknown as Record<string, number>)[t.prop] = t.base * (1 + env * t.amp);
    }
  }

  /**
   * Сменить тему на лету (клавиша 0): цвета неба/тумана/фонарей + пересборка
   * осадков. Чанки и геометрия не трогаются — мгновенно и без рывка.
   */
  applyTheme(theme: WorldTheme) {
    this.theme = theme;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.setHex(theme.fog);
    fog.near = theme.fogNear;
    fog.far = theme.fogFar;
    (this.scene.background as THREE.Color).setHex(theme.fog);
    this.hemi.color.setHex(theme.hemiSky);
    this.hemi.groundColor.setHex(theme.hemiGround);
    this.hemi.intensity = theme.hemiIntensity ?? 1.0;
    this.lampHeadMat.color.setHex(theme.lamp);
    this.lampHeadMat.emissive.setHex(theme.lamp);
    this.coneMat.color.setHex(theme.lamp);
    this.poolMat.color.setHex(theme.lamp).lerp(new THREE.Color(0xffffff), 0.3);
    for (const l of this.pooled) l.color.setHex(theme.lamp);
    this.buildSnow();
  }

  /** (Пере)собрать осадки по текущей теме: снег пушистый / дождь быстрый. */
  private buildSnow() {
    if (this.snow) {
      this.scene.remove(this.snow);
      this.snow.geometry.dispose();
      (this.snow.material as THREE.Material).dispose();
    }
    const base = IS_MOBILE ? 700 : 1600;
    this.SNOW_N = this.theme.precip === 'clear' ? Math.round(base * 0.25) : base;
    const isRain = this.theme.precip === 'rain';
    const pos = new Float32Array(this.SNOW_N * 3);
    this.snowVel = new Float32Array(this.SNOW_N * 2); // vy, фаза покачивания
    for (let i = 0; i < this.SNOW_N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.SNOW_BOX.x;
      pos[i * 3 + 1] = Math.random() * this.SNOW_BOX.y;
      pos[i * 3 + 2] = 15 - Math.random() * this.SNOW_BOX.z;
      this.snowVel[i * 2] = isRain ? 9 + Math.random() * 5 : 1.6 + Math.random() * 1.8;
      this.snowVel[i * 2 + 1] = Math.random() * Math.PI * 2;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
      color: this.theme.precipColor, size: isRain ? 0.06 : 0.09,
      transparent: true, opacity: isRain ? 0.55 : 0.85, sizeAttenuation: true,
    }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  /**
   * Записать наполнение чанка в его слот всех пулов (МИРОВЫЕ координаты).
   * Вызывается на старте и при переезде (recycle) — только setMatrixAt, без
   * создания/уничтожения объектов. Неиспользованные слоты прячутся.
   */
  private writeChunk(chunk: Chunk) {
    const { slot, index } = chunk;
    const chunkZ = -index * CHUNK_LEN;
    // район по дистанции (провинция/поле/город) — задаёт застройку И ширину дороги
    const bm = DISTRICTS[this.dAt(chunkZ - CHUNK_LEN / 2)] ?? DISTRICTS[0];
    chunk.lampHeads.length = 0;

    // полотно дороги/земли/обочин/тротуаров (следует рельефу + ширине полос)
    this.strips.write(slot, chunkZ);

    // кромка проезжей части (растёт на 3-полосных шоссе-участках) — декор стоит у неё
    const edge = (wz: number) => halfWidth(this.wAt(wz));

    // курсоры записи по каждому пулу (в пределах слота)
    const cur = new Map<InstancePool, number>();
    const put = (
      p: InstancePool, x: number, y: number, z: number,
      ry = 0, sx = 1, sy = 1, sz = 1, color?: number, rx = 0,
    ) => {
      const c = cur.get(p) ?? 0;
      if (c >= p.perChunk) return; // переполнение слота — лишнее не рисуем
      p.set(slot * p.perChunk + c, x, y, z, ry, sx, sy, sz, color, rx);
      cur.set(p, c + 1);
    };
    // ориентация плоского декора под дорогу: рыскание по повороту + тангаж по уклону
    const yawAt = (wz: number) => Math.atan2(this.cAt(wz + 2) - this.cAt(wz - 2), 4);
    const pitchAt = (wz: number) => -Math.atan2(this.hAt(wz + 2) - this.hAt(wz - 2), 4);

    // прерывистая осевая, местами стёртая; на шоссе — ещё 2 разделителя полос
    for (let z = 2; z < CHUNK_LEN; z += 6) {
      if (Math.random() < 0.2) continue;
      const wz = chunkZ - z;
      const cx = this.cAt(wz), y = this.hAt(wz) + 0.05;
      const ry = yawAt(wz), rx = pitchAt(wz); // штрих параллелен дороге и лежит на уклоне
      // 2 полосы → 1 линия по центру; 3 полосы → 2 линии-разделителя (между полосами)
      if (this.wAt(wz) > 0.5) {
        put(this.pLine, cx - LANE_DIVIDER, y, wz, ry, 1, 1, 1, undefined, rx);
        put(this.pLine, cx + LANE_DIVIDER, y, wz, ry, 1, 1, 1, undefined, rx);
      } else {
        put(this.pLine, cx, y, wz, ry, 1, 1, 1, undefined, rx);
      }
    }

    // пятна снега на обочинах
    for (let i = 0; i < 7; i++) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const wz = chunkZ - Math.random() * CHUNK_LEN;
      const sxw = 0.8 + Math.random() * 2.2, szl = 1.2 + Math.random() * 3;
      put(this.pPatch, s * (edge(wz) + 0.6 + Math.random() * 4.5) + this.cAt(wz),
        this.hAt(wz) + 0.075, wz, 0, sxw, 1, szl);
    }

    // фонари в шахматном порядке
    for (let z = LAMP_SPACING / 2; z < CHUNK_LEN; z += LAMP_SPACING) {
      const s = (Math.floor(z / LAMP_SPACING) + index) % 2 === 0 ? -1 : 1;
      const wz = chunkZ - z;
      const cx = this.cAt(wz);
      const x = s * (edge(wz) + 0.9) + cx;
      const hx = x - s * 0.55; // головка нависает над дорогой
      const h = this.hAt(wz);
      put(this.pPole, x, h + 2.7, wz);
      put(this.pHead, hx, h + 5.35, wz);
      put(this.pCone, hx, h + 3.0, wz);
      put(this.pGlow, hx, h + 0.05, wz, 0, 1, 1, 1, undefined, pitchAt(wz));
      chunk.lampHeads.push(new THREE.Vector3(hx, h + 5.1, wz));
    }

    // панельки по сторонам. В провинц-режиме отсекаем высотку(4)/ТЦ(5) —
    // промздание(6) провинциальное, остаётся.
    const kinds = bm.kinds; // район уже задаёт нужные виды зданий
    const density = bm.build; // <1 — редкая застройка (поле)
    const fieldGap = density < 0.5; // большие просветы между домами
    const buildCur = new Map<number, number>(); // курсор по виду дома
    for (const s of [-1, 1]) {
      let z = -Math.random() * 14;
      while (z > -CHUNK_LEN) {
        const ki = kinds[Math.floor(Math.random() * kinds.length)];
        const kind = this.kinds[ki];
        const rot = Math.random() < 0.4 ? Math.PI / 2 : 0;
        const w = rot ? kind.d : kind.w, d = rot ? kind.w : kind.d;
        const zc = z - w / 2;
        const wz = chunkZ + zc;
        const pool = this.pBuild[ki];
        const c = buildCur.get(ki) ?? 0;
        // редкая застройка: дом ставим лишь с вероятностью density (иначе тут поле)
        if (Math.random() < density && c < pool.perChunk) {
          pool.set(
            slot * pool.perChunk + c,
            s * (edge(wz) + 8 + d / 2 + Math.random() * 14) + this.cAt(wz),
            this.hAt(wz) + kind.h / 2 - kind.sink, // утоплены в рельеф (будка — на земле)
            wz, rot, kind.w, kind.h, kind.d,
          );
          buildCur.set(ki, c + 1);
        }
        z -= w + 6 + Math.random() * 18 + (fieldGap ? 30 + Math.random() * 40 : 0);
      }
    }
    // спрятать незаполненные слоты домов
    for (let ki = 0; ki < this.pBuild.length; ki++) {
      const pool = this.pBuild[ki];
      for (let c = buildCur.get(ki) ?? 0; c < pool.perChunk; c++) pool.hide(slot * pool.perChunk + c);
    }

    // деревья вдоль тротуаров и во дворах: ели со снегом + голые (густота по биому)
    for (const s of [-1, 1]) {
      let z = -Math.random() * 8;
      while (z > -CHUNK_LEN) {
        z -= 9 + Math.random() * 16;
        if (Math.random() >= bm.tree) continue; // густота деревьев — по биому
        const wz = chunkZ + z;
        const x = s * (edge(wz) + 6 + Math.random() * 16) + this.cAt(wz);
        const h = this.hAt(wz);
        if (Math.random() < bm.fir) {
          put(this.pFir, x, h + 1.8, wz);
          put(this.pFirSnow, x, h + 3.0, wz);
        } else {
          put(this.pTrunk, x, h + 1.2, wz);
          put(this.pCrown, x, h + 2.7, wz, 0, 1, 0.8 + Math.random() * 0.5, 1);
        }
      }
    }

    // ряд гаражей во дворе
    if (Math.random() < bm.garage) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const z0 = -8 - Math.random() * 30;
      const n = 3 + Math.floor(Math.random() * 4);
      for (let g = 0; g < n; g++) {
        const z = z0 - g * 3.6;
        const wz = chunkZ + z;
        const x = s * (edge(wz) + 17 + Math.random() * 2) + this.cAt(wz);
        const h = this.hAt(wz);
        put(this.pGarage, x, h + 1.25, wz, Math.PI / 2, 1, 1, 1,
          this.garageColors[Math.floor(Math.random() * this.garageColors.length)]);
        put(this.pGarageDoor, x - s * 3.15, h + 1.05, wz, -s * Math.PI / 2);
      }
    }

    // киоск с тёплой витриной
    if (Math.random() < bm.kiosk) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const wz = chunkZ - Math.random() * CHUNK_LEN;
      const x = s * (edge(wz) + 7.5) + this.cAt(wz);
      const h = this.hAt(wz);
      put(this.pKiosk, x, h + 1.2, wz);
      put(this.pKioskWin, x - s * 1.31, h + 1.35, wz, -s * Math.PI / 2);
    }

    // остановка (переиспользуемая группа)
    {
      const stopG = this.gStop.at(slot, 0);
      if (Math.random() < bm.stop) {
        const s = Math.random() < 0.5 ? -1 : 1;
        const wz = chunkZ - 10 - Math.random() * (CHUNK_LEN - 20);
        stopG.position.set(s * (edge(wz) + 4.6) + this.cAt(wz), this.hAt(wz), wz);
        // задняя стенка/лавка на сторону дороги: масштаб по z отражает сторону
        stopG.scale.z = s;
        stopG.visible = true;
      } else stopG.visible = false;
    }

    // припаркованные жигули у обочины (переиспользуемые группы)
    {
      const n = Math.random() < bm.parked ? 1 + (Math.random() < 0.3 ? 1 : 0) : 0;
      for (let p = 0; p < this.gCar.perChunk; p++) {
        const carG = this.gCar.at(slot, p);
        if (p < n) {
          const s = Math.random() < 0.5 ? -1 : 1;
          const wz = chunkZ - Math.random() * CHUNK_LEN;
          carG.position.set(s * (edge(wz) + 1.6) + this.cAt(wz), this.hAt(wz), wz);
          carG.rotation.y = (Math.random() < 0.85 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.06;
          carG.visible = true;
        } else carG.visible = false;
      }
    }

    // прятать незаполненные слоты остальных пулов
    for (const p of this.pools) {
      if (p === this.pLine || p === this.pPatch || p === this.pPole || p === this.pHead
        || p === this.pCone || p === this.pGlow || p === this.pFir || p === this.pFirSnow
        || p === this.pTrunk || p === this.pCrown || p === this.pGarage || p === this.pGarageDoor
        || p === this.pKiosk || p === this.pKioskWin) {
        for (let c = cur.get(p) ?? 0; c < p.perChunk; c++) p.hide(slot * p.perChunk + c);
      }
    }
  }

  /**
   * Перезаписать все чанки на их текущих индексах. Нужно, когда геометрия
   * (heightAt/curveAt) сменилась после конструктора — напр., в endless мир
   * строится со заглушкой, а после привязки цепочки дорогу надо перестроить.
   */
  rebuild() {
    for (const c of this.chunks) this.writeChunk(c);
    for (const p of this.pools) p.flush();
  }

  update(dt: number, carPos: THREE.Vector3, pulseDepth = 0) {
    // #16/#A глубину пульса (окна/фонари дышат в бит) считает дирижёр (канал
    // worldPulse, гейтирован состоянием): в холодном затишье ≈0 → мир НЕПОДВИЖЕН.
    this.pulse(pulseDepth);
    // переезд чанков — перезапись слота под новый индекс (ноль аллокаций)
    let recycled = false;
    for (const c of this.chunks) {
      if (-c.index * CHUNK_LEN - CHUNK_LEN > carPos.z + CHUNK_LEN * 1.5) {
        c.index += CHUNKS;
        this.writeChunk(c);
        recycled = true;
      }
    }
    if (recycled) for (const p of this.pools) p.flush();

    // пул SpotLight — к ближайшим фонарям вокруг машины.
    // собираем кандидатов в переиспользуемый пул (без new Vector3 в кадре)
    let hc = 0;
    for (const c of this.chunks)
      for (const h of c.lampHeads) {
        const wz = h.z; // lampHeads уже в мировых координатах
        if (wz < carPos.z + 12 && wz > carPos.z - 60) {
          let v = this.headPool[hc];
          if (!v) { v = new THREE.Vector3(); this.headPool[hc] = v; }
          v.set(h.x, h.y, wz);
          hc++;
        }
      }
    // каждому прожектору — ближайший свободный кандидат (выбор минимумом вместо
    // полной сортировки с замыканием каждый кадр); фонарей мало → дёшево
    for (let k = 0; k < hc; k++) this.headUsed[k] = false;
    for (let i = 0; i < this.pooled.length; i++) {
      const l = this.pooled[i];
      let best = -1, bestD = Infinity;
      for (let k = 0; k < hc; k++) {
        if (this.headUsed[k]) continue;
        const d = Math.abs(this.headPool[k].z - carPos.z);
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) {
        this.headUsed[best] = true;
        const v = this.headPool[best];
        l.visible = true;
        l.position.copy(v);
        l.target.position.set(v.x, v.y - 5.1, v.z);
      } else l.visible = false;
    }

    // снег: по x/z хлопья неподвижны, падение с обёрткой бокса вокруг машины
    if (!this.snow) return;
    const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const t = performance.now() / 1000;
    const zMin = carPos.z - this.SNOW_BOX.z + 15;
    const zSpan = this.SNOW_BOX.z;
    const xMin = carPos.x - this.SNOW_BOX.x / 2; // бокс следует за машиной в поворотах
    const xSpan = this.SNOW_BOX.x;
    const yBase = carPos.y - 3; // снежный слой следует за рельефом
    const yTop = yBase + this.SNOW_BOX.y;
    const xMax = xMin + xSpan, zMax = zMin + zSpan;
    const swayDt = (this.theme.precip === 'rain' ? 0.08 : 0.4) * dt; // инвариант — из цикла
    for (let i = 0; i < this.SNOW_N; i++) {
      let y = arr[i * 3 + 1] - this.snowVel[i * 2] * dt;
      if (y < yBase) y += this.SNOW_BOX.y;
      else if (y > yTop) y = yBase + Math.random() * this.SNOW_BOX.y;
      arr[i * 3 + 1] = y;
      // враппинг вычитанием вместо двойного modulo — заметно дешевле на ~1600 частиц
      let x = arr[i * 3] + Math.sin(t * 1.3 + this.snowVel[i * 2 + 1]) * swayDt;
      if (x < xMin) x += xSpan; else if (x >= xMax) x -= xSpan;
      arr[i * 3] = x;
      let z = arr[i * 3 + 2]; // бокс едет за машиной — z перевешиваем относительно него
      while (z < zMin) z += zSpan;
      while (z >= zMax) z -= zSpan;
      arr[i * 3 + 2] = z;
    }
    attr.needsUpdate = true;
  }

  dispose() {
    for (const p of this.pools) p.dispose();
    this.gCar.dispose();
    this.gStop.dispose();
    this.strips.dispose();
    if (this.snow) this.snow.geometry.dispose();
  }
}
