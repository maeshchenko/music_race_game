import * as THREE from 'three';
import type { Song } from 'midi-gen/core';
import type { Level } from './level';

/**
 * Неоновые блоки: единый собираемый поток. Одновременные ноты склеиваются
 * в один блок-«аккорд» (крупнее, дороже), полоса ведётся мелодическим
 * контуром с ограничением достижимости — машина всегда успевает
 * перестроиться. Дальние прыжки (край→край) — только хард, редко.
 */

const LANE_X = 2.7; // три полосы: -2.7, 0, +2.7
const COLLECT_LATERAL = 1.45;
const CLUSTER_SEC = 0.09; // ноты ближе — один блок-аккорд

/** Сложность: плотность потока и подвижность дорожки. */
export type Difficulty = 'light' | 'norm' | 'hard';
const DIFF_CFG: Record<Difficulty, {
  rolesPerBar: number;
  laneShiftGap: number; // мин. время между сменами полосы, с
  maxPerSec: number; // кап плотности блоков
  farJump: boolean; // разрешён ли прыжок край→край
}> = {
  light: { rolesPerBar: 1, laneShiftGap: 0.8, maxPerSec: 1.5, farJump: false },
  norm: { rolesPerBar: 1, laneShiftGap: 0.55, maxPerSec: 2.5, farJump: false },
  hard: { rolesPerBar: 2, laneShiftGap: 0.4, maxPerSec: 4, farJump: true },
};

const FAR_JUMP_COOLDOWN = 15; // с

export const LANE_COLORS = [
  new THREE.Color('#22ffee'), // циан
  new THREE.Color('#ff44ff'), // маджента
  new THREE.Color('#66ff66'), // лайм
];
export const LANE_CSS = ['#22ffee', '#ff44ff', '#66ff66'];

export interface BlockDef {
  dist: number;
  lane: number; // -1 | 0 | 1 — для цвета
  x: number; // мировой x (ось дороги + полоса); магнит двигает
  y: number;
  vel: number;
  /** Сколько нот склеено: множитель очков (кап 3) и размера. */
  count: number;
  /** Нота, бонус-магнит, золотой джекпот или мистери-«?». */
  kind: 'note' | 'magnet' | 'gold' | 'mystery';
  collected: boolean;
  missed: boolean;
}

/** Казино-слой: есть ли в заезде золотой джекпот и сколько мистери-блоков. */
export interface BlockExtras {
  gold: boolean;
  mystery: number;
}

const MAGNET_COLOR = new THREE.Color('#ffd24d');
const GOLD_COLOR = new THREE.Color('#fff3a0');
const MYSTERY_COLOR = new THREE.Color('#ffffff');
const MAGNET_EVERY = [25, 40]; // раз в столько секунд трека, случайно

export class Blocks {
  readonly mesh: THREE.InstancedMesh;
  private defs: BlockDef[] = [];
  private cursor = 0; // первый блок, который ещё может быть собран/пропущен
  private dummy = new THREE.Object3D();
  private colorTmp = new THREE.Color();

  constructor(
    song: Song, level: Level, diff: Difficulty = 'norm',
    extras: BlockExtras = { gold: false, mystery: 0 },
  ) {
    const cfg = DIFF_CFG[diff];
    const secPerTick = 60 / (song.ppq * song.bpm);

    // покрытие всех тактов: в каждом такте — ноты самых «мелодичных»
    // из звучащих дорожек (на хард — двух)
    const ROLE_ORDER = ['lead', 'arp', 'counter', 'chords', 'bass', 'drums'] as const;
    const barTicks = (song.ppq * 4 * song.timeSig[0]) / song.timeSig[1];
    const barsCount = Math.max(1, Math.ceil(song.durationTicks / barTicks));
    const byRoleBar = new Map<string, (typeof song.tracks[0]['notes'])[]>();
    for (const tr of song.tracks) {
      if (byRoleBar.has(tr.role)) continue; // первая дорожка роли
      const buckets: (typeof tr.notes)[] = Array.from({ length: barsCount }, () => []);
      for (const n of tr.notes) {
        const b = Math.min(barsCount - 1, Math.floor(n.start / barTicks));
        buckets[b].push(n);
      }
      byRoleBar.set(tr.role, buckets);
    }
    const chosen: typeof song.tracks[0]['notes'] = [];
    for (let b = 0; b < barsCount; b++) {
      let taken = 0;
      for (const role of ROLE_ORDER) {
        const ns = byRoleBar.get(role)?.[b];
        if (ns?.length) {
          chosen.push(...ns);
          if (++taken >= cfg.rolesPerBar) break;
        }
      }
    }
    chosen.sort((a, b) => a.start - b.start);

    // кластеризация: одновременные/почти одновременные ноты → один блок
    interface Cluster { t: number; pitch: number; vel: number; count: number; }
    const clusters: Cluster[] = [];
    for (const n of chosen) {
      const t = n.start * secPerTick;
      if (t < 5 || t >= level.durationSec - 3) continue; // разгон и финиш без суеты
      const last = clusters[clusters.length - 1];
      if (last && t - last.t <= CLUSTER_SEC) {
        last.vel = Math.max(last.vel, n.vel);
        last.pitch = (last.pitch * last.count + n.pitch) / (last.count + 1);
        last.count++;
      } else {
        clusters.push({ t, pitch: n.pitch, vel: n.vel, count: 1 });
      }
    }

    // кап плотности: не чаще maxPerSec
    const minGap = 1 / cfg.maxPerSec;
    const stream: Cluster[] = [];
    for (const c of clusters) {
      const last = stream[stream.length - 1];
      if (last && c.t - last.t < minGap) continue;
      stream.push(c);
    }

    // полосы мелодическим контуром, с достижимостью
    let lane = 0;
    let lastShiftT = -10;
    let lastFarT = -100;
    let prevPitch: number | null = null;
    for (const c of stream) {
      const dPitch = prevPitch === null ? 0 : c.pitch - prevPitch;
      prevPitch = c.pitch;
      const canShift = c.t - lastShiftT >= cfg.laneShiftGap;
      if (canShift) {
        let dir = 0;
        if (dPitch > 1) dir = 1;
        else if (dPitch < -1) dir = -1;
        // дальний прыжок край→край: только хард, по кулдауну, не подряд
        if (cfg.farJump && Math.abs(dPitch) > 12 && Math.abs(lane) === 1 &&
            Math.sign(dir) === -Math.sign(lane) && c.t - lastFarT > FAR_JUMP_COOLDOWN &&
            c.t - lastShiftT >= cfg.laneShiftGap * 1.5) {
          lane = -lane;
          lastFarT = c.t;
          lastShiftT = c.t;
        } else if (dir !== 0 && lane + dir >= -1 && lane + dir <= 1) {
          lane += dir;
          lastShiftT = c.t;
        } else if (dir === 0 && lane !== 0 && c.t - lastShiftT >= cfg.laneShiftGap * 2.2) {
          lane += lane > 0 ? -1 : 1; // без мелодического движения — дрейф к центру
          lastShiftT = c.t;
        }
      }
      const dist = level.distAt(c.t);
      this.defs.push({
        dist,
        lane,
        x: level.curveAt(dist) + lane * LANE_X,
        y: level.heightAt(dist) + 0.75,
        vel: c.vel,
        count: Math.min(c.count, 3),
        kind: 'note',
        collected: false,
        missed: false,
      });
    }

    // бонусы-магниты: на пути потока, раз в 25–40 секунд
    {
      let nextAt = 12 + Math.random() * 10;
      for (let i = 1; i < stream.length; i++) {
        if (stream[i].t < nextAt) continue;
        nextAt = stream[i].t + MAGNET_EVERY[0] + Math.random() * (MAGNET_EVERY[1] - MAGNET_EVERY[0]);
        const base = this.defs[i]; // та же полоса, что у ближайшего блока
        if (!base) break;
        const dist = base.dist + 5;
        this.defs.push({
          dist,
          lane: base.lane,
          x: level.curveAt(dist) + base.lane * LANE_X,
          y: level.heightAt(dist) + 0.85,
          vel: 100,
          count: 1,
          kind: 'magnet',
          collected: false,
          missed: false,
        });
      }
    }

    // казино-слой: спец-блоки рядом с потоком, в средней части трека
    {
      const placeSpecial = (kind: 'gold' | 'mystery', frac: number) => {
        const base = this.defs[Math.floor(this.defs.length * Math.min(0.92, frac))];
        if (!base) return;
        const dist = base.dist + 4;
        this.defs.push({
          dist,
          lane: base.lane,
          x: level.curveAt(dist) + base.lane * LANE_X,
          y: level.heightAt(dist) + 0.9,
          vel: 127,
          count: 1,
          kind,
          collected: false,
          missed: false,
        });
      };
      // джекпот — неожиданно, где-то в середине
      if (extras.gold) placeSpecial('gold', 0.35 + Math.random() * 0.4);
      // мистери — равномерно по треку, со случайным сдвигом
      for (let m = 0; m < extras.mystery; m++)
        placeSpecial('mystery', (0.2 + 0.6 * (m / Math.max(1, extras.mystery - 1) || 0))
          + Math.random() * 0.12);
      this.defs.sort((a, b) => a.dist - b.dist);
    }

    const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, // мимо ACES — неон остаётся кислотным
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.defs.length);
    this.mesh.frustumCulled = false;
    this.defs.forEach((b, i) => {
      this.dummy.position.set(b.x, b.y, -b.dist);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i,
        b.kind === 'magnet' ? MAGNET_COLOR
        : b.kind === 'gold' ? GOLD_COLOR
        : b.kind === 'mystery' ? MYSTERY_COLOR
        : LANE_COLORS[b.lane + 1]);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get total() {
    return this.defs.length;
  }

  /** Полосы, занятые блоками в окрестности дистанции — для честных преград. */
  lanesNear(dist: number, span: number): Set<number> {
    const lanes = new Set<number>();
    // defs отсортированы по dist — бинарный поиск левой границы
    let lo = 0, hi = this.defs.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.defs[mid].dist < dist - span) lo = mid;
      else hi = mid;
    }
    for (let i = lo; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > dist + span) break;
      if (b.dist >= dist - span) lanes.add(b.lane);
    }
    return lanes;
  }

  /**
   * Магнит, сбор, пропуск и анимация ближних блоков.
   * onCollect(блок) — очки/эффекты; onMiss() — для счётчика промахов.
   */
  update(
    carDist: number, carWorldX: number, time: number, dt: number, fever: boolean,
    magnet: boolean,
    onCollect: (b: BlockDef) => void, onMiss: () => void,
  ) {
    // пропущенные позади (бонус-магнит промахом не считается)
    while (this.cursor < this.defs.length && this.defs[this.cursor].dist < carDist - 2.5) {
      const b = this.defs[this.cursor];
      if (!b.collected && !b.missed) {
        b.missed = true;
        if (b.kind === 'note') onMiss();
      }
      this.cursor++;
    }

    // магнит активен только пока действует подобранный бонус
    if (magnet) {
      for (let i = this.cursor; i < this.defs.length; i++) {
        const b = this.defs[i];
        if (b.dist > carDist + 9) break;
        if (b.collected || b.missed) continue;
        if (b.dist > carDist - 1 && Math.abs(b.x - carWorldX) < 4.5)
          b.x += (carWorldX - b.x) * Math.min(1, dt * 10);
      }
    }

    // окно сбора
    for (let i = this.cursor; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > carDist + 2.0) break;
      if (!b.collected && !b.missed &&
          b.dist <= carDist + 1.2 && Math.abs(b.x - carWorldX) < COLLECT_LATERAL) {
        b.collected = true;
        onCollect(b);
        this.dummy.position.set(b.x, b.y, -b.dist);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
    }

    // вращение и пульс ближних видимых
    const pulseAmp = fever ? 0.16 : 0.07;
    let colorDirty = false;
    for (let i = this.cursor; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > carDist + 170) break;
      if (b.collected) continue;
      this.dummy.position.set(b.x, b.y, -b.dist);
      if (b.kind === 'magnet') {
        // бонус крутится заметно быстрее и крупнее
        this.dummy.rotation.set(time * 2.2, time * 3.1, 0);
        this.dummy.scale.setScalar(1.15 + Math.sin(time * 6) * 0.12);
      } else if (b.kind === 'gold') {
        // джекпот: крупный, бешено крутится, видно издалека
        this.dummy.rotation.set(time * 3, time * 4.2, time * 1.5);
        this.dummy.scale.setScalar(1.5 + Math.sin(time * 8) * 0.18);
      } else if (b.kind === 'mystery') {
        // «?»: крупный, дышит и переливается — что внутри, узнаешь на подборе
        this.dummy.rotation.set(time * 1.3, time * 2.5, time * 1.2);
        this.dummy.scale.setScalar(1.5 + Math.sin(time * 4.5) * 0.25);
        this.colorTmp.setHSL((time * 0.9 + i * 0.13) % 1, 0.95, 0.7);
        this.mesh.setColorAt(i, this.colorTmp);
        colorDirty = true;
      } else {
        this.dummy.rotation.set(0, time * 1.4 + i * 0.7, time * 0.9 + i);
        const pulse = 1 + Math.sin(time * 5 + i) * pulseAmp;
        const size = (0.7 + (b.vel / 127) * 0.6) * (1 + 0.18 * (b.count - 1));
        this.dummy.scale.setScalar(size * pulse);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
