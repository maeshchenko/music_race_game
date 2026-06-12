import * as THREE from 'three';
import { buildCar } from './car';

/**
 * Вечерняя провинция: дорога, панельки с тёплыми окнами, натриевые фонари,
 * снег. Мир — «беговая дорожка» из чанков: машина едет в -z, чанки позади
 * переезжают вперёд. Вся геометрия следует рельефу heightAt(z) из музыки.
 */

const CHUNK_LEN = 60;
const CHUNKS = 13; // ~780 м видимой улицы
const LAMP_SPACING = 20;
const ROAD_W = 9;
const POOLED_LIGHTS = 4;

/** Высота мира в точке z (мировая координата, вперёд = -z). */
export type HeightFn = (z: number) => number;
/** Боковое смещение оси дороги в точке z — повороты. */
export type CurveFn = (z: number) => number;

// --- процедурная текстура панельки --------------------------------------

interface BuildingKind {
  w: number; h: number; d: number;
  mats: THREE.Material[];
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

function buildingKind(w: number, h: number, d: number, floors: number, cols: number, base: string): BuildingKind {
  const { map, emissiveMap } = panelTextures(floors, cols, base, 0.28);
  const side = new THREE.MeshLambertMaterial({
    map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.9,
  });
  const roof = new THREE.MeshLambertMaterial({ color: 0x23252b });
  // порядок граней BoxGeometry: +x -x +y -y +z -z
  return { w, h, d, mats: [side, side, roof, roof, side, side] };
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

// --- чанк улицы -----------------------------------------------------------

interface Chunk {
  group: THREE.Group;
  /** Индекс чанка по дороге (z = -index * CHUNK_LEN). */
  index: number;
  lampHeads: THREE.Vector3[]; // локальные позиции головок для пула света
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
  private poolMat = new THREE.MeshBasicMaterial({
    map: makeGlowTexture(), transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  private poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6);
  private headGeo = new THREE.BoxGeometry(0.5, 0.16, 0.22);
  private coneGeo = new THREE.ConeGeometry(2.6, 4.8, 12, 1, true);
  // зимний двор: ели, голые деревья, гаражи, киоски, остановки
  private firGeo = new THREE.ConeGeometry(1.5, 3.6, 7);
  private firMat = new THREE.MeshLambertMaterial({ color: 0x1d2b22 });
  private firSnowGeo = new THREE.ConeGeometry(1.1, 1.6, 7);
  private firSnowMat = new THREE.MeshLambertMaterial({ color: 0x77808c });
  private trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 2.4, 5);
  private trunkMat = new THREE.MeshLambertMaterial({ color: 0x2a2520 });
  private crownGeo = new THREE.IcosahedronGeometry(1.1, 0);
  private crownMat = new THREE.MeshLambertMaterial({ color: 0x191d1a });
  private garageGeo = new THREE.BoxGeometry(3.4, 2.6, 6.2);
  private garageMats = [0x4a4440, 0x3f4a44, 0x54504a, 0x44424c].map(
    (c) => new THREE.MeshLambertMaterial({ color: c }),
  );
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
  private sharedGeos: Set<THREE.BufferGeometry>;
  private pooled: THREE.SpotLight[] = [];
  private snow!: THREE.Points;
  private snowVel: Float32Array;
  private readonly SNOW_N = 1600;
  private readonly SNOW_BOX = new THREE.Vector3(50, 22, 70);

  constructor(
    private hAt: HeightFn = () => 0,
    private cAt: CurveFn = () => 0,
  ) {
    this.sharedGeos = new Set([
      this.boxGeo, this.poleGeo, this.headGeo, this.coneGeo,
      this.firGeo, this.firSnowGeo, this.trunkGeo, this.crownGeo,
      this.garageGeo, this.garageDoorGeo, this.kioskGeo, this.kioskWinGeo,
    ]);

    const fogColor = 0x252834;
    this.scene.fog = new THREE.Fog(fogColor, 25, 230);
    this.scene.background = new THREE.Color(fogColor);

    this.scene.add(new THREE.HemisphereLight(0x5a648a, 0x1c1c24, 1.0));
    const moon = new THREE.DirectionalLight(0x8a96b8, 0.45);
    moon.position.set(-30, 60, -20);
    this.scene.add(moon);

    this.kinds = [
      buildingKind(22, 15, 12, 5, 8, '#4a4742'), // хрущёвка 5 эт.
      buildingKind(15, 27, 12, 9, 5, '#474c54'), // панелька 9 эт.
      buildingKind(28, 27, 12, 9, 10, '#52504c'), // длинная 9 эт.
      buildingKind(13, 36, 13, 12, 4, '#41464f'), // свечка 12 эт.
    ];

    for (let i = 0; i < POOLED_LIGHTS; i++) {
      // конус вниз, угол как у видимого плафона: atan(2.6 / 4.8) ≈ 0.5 рад —
      // машина освещается только когда реально въезжает в пятно фонаря
      const l = new THREE.SpotLight(0xffa860, 70, 14, 0.52, 0.55, 1.2);
      this.scene.add(l, l.target);
      this.pooled.push(l);
    }

    for (let i = 0; i < CHUNKS; i++) this.chunks.push(this.makeChunk(i));

    // снег — мировые координаты: хлопья только падают, машина едет сквозь
    const pos = new Float32Array(this.SNOW_N * 3);
    this.snowVel = new Float32Array(this.SNOW_N * 2); // vy, фаза покачивания
    for (let i = 0; i < this.SNOW_N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.SNOW_BOX.x;
      pos[i * 3 + 1] = Math.random() * this.SNOW_BOX.y;
      pos[i * 3 + 2] = 15 - Math.random() * this.SNOW_BOX.z;
      this.snowVel[i * 2] = 1.6 + Math.random() * 1.8;
      this.snowVel[i * 2 + 1] = Math.random() * Math.PI * 2;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({
      color: 0xd6dbe4, size: 0.09, transparent: true, opacity: 0.85, sizeAttenuation: true,
    }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  /**
   * Полоса вдоль дороги, повторяющая рельеф. Локальный z геометрии
   * симметричен (±len/2); zWorldCenter — мировой z центра полосы.
   */
  private stripGeo(w: number, len: number, segs: number, zWorldCenter: number, yOff: number): THREE.PlaneGeometry {
    const g = new THREE.PlaneGeometry(w, len, 1, segs);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const wz = zWorldCenter + p.getZ(i);
      p.setY(i, this.hAt(wz) + yOff);
      p.setX(i, p.getX(i) + this.cAt(wz)); // полоса следует поворотам
    }
    g.computeVertexNormals();
    return g;
  }

  private makeChunk(index: number): Chunk {
    const group = new THREE.Group();
    const chunkZ = -index * CHUNK_LEN;
    const zMid = -CHUNK_LEN / 2; // локальный центр чанка
    const lampHeads: THREE.Vector3[] = [];

    const strip = (w: number, mat: THREE.Material, x: number, yOff: number, segs = 16) => {
      const m = new THREE.Mesh(this.stripGeo(w, CHUNK_LEN, segs, chunkZ + zMid, yOff), mat);
      m.position.set(x, 0, zMid);
      group.add(m);
      return m;
    };

    strip(500, this.groundMat, 0, -0.14, 16); // земля до домов
    strip(ROAD_W, this.roadMat, 0, 0, 16);
    for (const s of [-1, 1]) {
      strip(2.4, this.shoulderMat, s * (ROAD_W / 2 + 1.2), 0.012);
      strip(3.4, this.sidewalkMat, s * (ROAD_W / 2 + 2.4 + 1.7), 0.06);
    }

    // прерывистая осевая, местами стёртая
    for (let z = 2; z < CHUNK_LEN; z += 6) {
      if (Math.random() < 0.2) continue;
      const line = new THREE.Mesh(this.stripGeo(0.14, 2.6, 2, chunkZ - z, 0.03), this.lineMat);
      line.position.set(0, 0, -z);
      group.add(line);
    }

    // пятна снега на обочинах
    for (let i = 0; i < 7; i++) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const z = -Math.random() * CHUNK_LEN;
      const patch = new THREE.Mesh(
        this.stripGeo(0.8 + Math.random() * 2.2, 1.2 + Math.random() * 3, 2, chunkZ + z, 0.075),
        this.snowPatchMat,
      );
      patch.position.set(s * (ROAD_W / 2 + 0.6 + Math.random() * 4.5), 0, z);
      group.add(patch);
    }

    // фонари в шахматном порядке
    for (let z = LAMP_SPACING / 2; z < CHUNK_LEN; z += LAMP_SPACING) {
      const s = (Math.floor(z / LAMP_SPACING) + index) % 2 === 0 ? -1 : 1;
      const cx = this.cAt(chunkZ - z);
      const x = s * (ROAD_W / 2 + 0.9) + cx;
      const hx = x - s * 0.55; // головка нависает над дорогой
      const h = this.hAt(chunkZ - z);
      const pole = new THREE.Mesh(this.poleGeo, this.poleMat);
      pole.position.set(x, h + 2.7, -z);
      const head = new THREE.Mesh(this.headGeo, this.lampHeadMat);
      head.position.set(hx, h + 5.35, -z);
      const cone = new THREE.Mesh(this.coneGeo, this.coneMat);
      cone.position.set(hx, h + 3.0, -z);
      // глоу-пятно «как блик», статичное под фонарём, повторяет рельеф
      // (stripGeo сам добавляет кривизну — x-офсет без неё)
      const pool = new THREE.Mesh(this.stripGeo(8.5, 11, 4, chunkZ - z, 0.05), this.poolMat);
      pool.position.set(hx - cx, 0, -z);
      group.add(pole, head, cone, pool);
      lampHeads.push(new THREE.Vector3(hx, h + 5.1, -z));
    }

    // панельки по сторонам
    for (const s of [-1, 1]) {
      let z = -Math.random() * 14;
      while (z > -CHUNK_LEN) {
        const kind = this.kinds[Math.floor(Math.random() * this.kinds.length)];
        const rot = Math.random() < 0.4 ? Math.PI / 2 : 0;
        const w = rot ? kind.d : kind.w, d = rot ? kind.w : kind.d;
        const b = new THREE.Mesh(this.boxGeo, kind.mats);
        b.scale.set(kind.w, kind.h, kind.d);
        b.rotation.y = rot;
        const zc = z - w / 2;
        b.position.set(
          s * (ROAD_W / 2 + 8 + d / 2 + Math.random() * 14) + this.cAt(chunkZ + zc),
          this.hAt(chunkZ + zc) + kind.h / 2 - 1, // чуть утоплены в рельеф
          zc,
        );
        group.add(b);
        z -= w + 6 + Math.random() * 18;
      }
    }

    // деревья вдоль тротуаров и во дворах: ели со снегом + голые
    for (const s of [-1, 1]) {
      let z = -Math.random() * 8;
      while (z > -CHUNK_LEN) {
        const x = s * (ROAD_W / 2 + 6 + Math.random() * 16) + this.cAt(chunkZ + z);
        const h = this.hAt(chunkZ + z);
        if (Math.random() < 0.55) {
          const fir = new THREE.Mesh(this.firGeo, this.firMat);
          fir.position.set(x, h + 1.8, z);
          const cap = new THREE.Mesh(this.firSnowGeo, this.firSnowMat);
          cap.position.set(x, h + 3.0, z);
          group.add(fir, cap);
        } else {
          const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMat);
          trunk.position.set(x, h + 1.2, z);
          const crown = new THREE.Mesh(this.crownGeo, this.crownMat);
          crown.scale.set(1, 0.8 + Math.random() * 0.5, 1);
          crown.position.set(x, h + 2.7, z);
          group.add(trunk, crown);
        }
        z -= 9 + Math.random() * 16;
      }
    }

    // ряд гаражей во дворе
    if (Math.random() < 0.35) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const z0 = -8 - Math.random() * 30;
      const n = 3 + Math.floor(Math.random() * 4);
      for (let g = 0; g < n; g++) {
        const z = z0 - g * 3.6;
        const x = s * (ROAD_W / 2 + 17 + Math.random() * 2) + this.cAt(chunkZ + z);
        const box = new THREE.Mesh(
          this.garageGeo, this.garageMats[Math.floor(Math.random() * this.garageMats.length)],
        );
        box.rotation.y = Math.PI / 2;
        box.position.set(x, this.hAt(chunkZ + z) + 1.25, z);
        const door = new THREE.Mesh(this.garageDoorGeo, this.garageDoorMat);
        door.rotation.y = -s * Math.PI / 2;
        door.position.set(x - s * 3.15, this.hAt(chunkZ + z) + 1.05, z);
        group.add(box, door);
      }
    }

    // киоск с тёплой витриной
    if (Math.random() < 0.3) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const z = -Math.random() * CHUNK_LEN;
      const x = s * (ROAD_W / 2 + 7.5) + this.cAt(chunkZ + z);
      const h = this.hAt(chunkZ + z);
      const kiosk = new THREE.Mesh(this.kioskGeo, this.kioskMat);
      kiosk.position.set(x, h + 1.2, z);
      const win = new THREE.Mesh(this.kioskWinGeo, this.kioskWinMat);
      win.rotation.y = -s * Math.PI / 2;
      win.position.set(x - s * 1.31, h + 1.35, z);
      group.add(kiosk, win);
    }

    // остановка: задняя стенка, крыша, лавка, холодная лампа
    if (Math.random() < 0.3) {
      const s = Math.random() < 0.5 ? -1 : 1;
      const z = -10 - Math.random() * (CHUNK_LEN - 20);
      const bx = s * (ROAD_W / 2 + 4.6) + this.cAt(chunkZ + z);
      const h = this.hAt(chunkZ + z);
      const stop = new THREE.Group();
      const back = new THREE.Mesh(new THREE.BoxGeometry(4, 2.0, 0.14), this.stopWallMat);
      back.position.set(0, 1.2, s * 0.7);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.12, 1.8), this.stopWallMat);
      roof.position.set(0, 2.25, 0);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.09, 0.5), this.stopWallMat);
      bench.position.set(0, 0.55, s * 0.45);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.2), this.stopLightMat);
      lamp.position.set(0, 2.16, 0);
      stop.add(back, roof, bench, lamp);
      stop.position.set(bx, h, z);
      group.add(stop);
    }

    // припаркованные жигули у обочины, фары потушены
    if (Math.random() < 0.55) {
      const n = 1 + (Math.random() < 0.3 ? 1 : 0);
      for (let p = 0; p < n; p++) {
        const s = Math.random() < 0.5 ? -1 : 1;
        const z = -Math.random() * CHUNK_LEN;
        const parked = buildCar({
          color: this.vazColors[Math.floor(Math.random() * this.vazColors.length)],
          lightsOn: false,
        });
        parked.position.set(
          s * (ROAD_W / 2 + 1.6) + this.cAt(chunkZ + z),
          this.hAt(chunkZ + z),
          z,
        );
        parked.rotation.y = (Math.random() < 0.85 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.06;
        group.add(parked);
      }
    }

    group.position.z = chunkZ;
    this.scene.add(group);
    return { group, index, lampHeads };
  }

  /** Пересобрать наполнение чанка под новый индекс (переезд вперёд). */
  private recycle(chunk: Chunk, newIndex: number) {
    this.scene.remove(chunk.group);
    chunk.group.traverse((o) => {
      if (o instanceof THREE.Mesh && !this.sharedGeos.has(o.geometry)) o.geometry.dispose();
    });
    const fresh = this.makeChunk(newIndex);
    chunk.group = fresh.group;
    chunk.index = newIndex;
    chunk.lampHeads = fresh.lampHeads;
  }

  update(dt: number, carPos: THREE.Vector3) {
    // переезд чанков
    for (const c of this.chunks) {
      if (-c.index * CHUNK_LEN - CHUNK_LEN > carPos.z + CHUNK_LEN * 1.5)
        this.recycle(c, c.index + CHUNKS);
    }

    // пул SpotLight — к ближайшим фонарям вокруг машины
    const heads: THREE.Vector3[] = [];
    for (const c of this.chunks)
      for (const h of c.lampHeads) {
        const wz = h.z + c.group.position.z;
        if (wz < carPos.z + 12 && wz > carPos.z - 60)
          heads.push(new THREE.Vector3(h.x, h.y, wz));
      }
    heads.sort((a, b) => Math.abs(a.z - carPos.z) - Math.abs(b.z - carPos.z));
    this.pooled.forEach((l, i) => {
      if (heads[i]) {
        l.visible = true;
        l.position.copy(heads[i]);
        l.target.position.set(heads[i].x, heads[i].y - 5.1, heads[i].z);
      } else l.visible = false;
    });

    // снег: по x/z хлопья неподвижны, падение с обёрткой бокса вокруг машины
    const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const t = performance.now() / 1000;
    const zMin = carPos.z - this.SNOW_BOX.z + 15;
    const zSpan = this.SNOW_BOX.z;
    const xMin = carPos.x - this.SNOW_BOX.x / 2; // бокс следует за машиной в поворотах
    const xSpan = this.SNOW_BOX.x;
    const yBase = carPos.y - 3; // снежный слой следует за рельефом
    for (let i = 0; i < this.SNOW_N; i++) {
      let y = arr[i * 3 + 1] - this.snowVel[i * 2] * dt;
      if (y < yBase) y += this.SNOW_BOX.y;
      else if (y > yBase + this.SNOW_BOX.y) y = yBase + Math.random() * this.SNOW_BOX.y;
      arr[i * 3 + 1] = y;
      const x = arr[i * 3] + Math.sin(t * 1.3 + this.snowVel[i * 2 + 1]) * dt * 0.4;
      arr[i * 3] = xMin + ((((x - xMin) % xSpan) + xSpan) % xSpan);
      const z = arr[i * 3 + 2];
      arr[i * 3 + 2] = zMin + ((((z - zMin) % zSpan) + zSpan) % zSpan);
    }
    attr.needsUpdate = true;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
  }
}
