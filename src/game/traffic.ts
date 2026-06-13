import * as THREE from 'three';
import { buildCar, SHARED_CAR_GEOS } from './car';
import type { Level } from './level';
import type { Blocks } from './blocks';
import type { Difficulty } from './blocks';

/**
 * Преграды: встречные и попутные жигули + сугробы. Генерация — по моментам
 * встречи с игроком (дистанция игрока известна из level), полоса выбирается
 * свободной от потока блоков в точке встречи — уворот всегда возможен,
 * невозможного выбора «блок или столкновение» не бывает.
 */

const LANE_X = 2.7;

// генерим гуще запаса — рантайм-интенсивность активирует часть (см. setIntensity);
// низкая интенсивность = редкий трафик, высокая = весь поток (веселее на харде)
const DIFF_INTERVAL: Record<Difficulty, [number, number]> = {
  light: [2.6, 4.2],
  norm: [1.6, 2.8],
  hard: [1.0, 1.9],
};

const VAZ_COLORS = [0x6b1220, 0x8a8576, 0x2c3e5c, 0x9aa0a8, 0x2f4a38];

interface Obstacle {
  kind: 'oncoming' | 'slow' | 'pile';
  group: THREE.Group | THREE.Mesh;
  lane: number;
  /** Позиция по трассе в момент t: meetDist + v·(t − tMeet). */
  meetDist: number;
  tMeet: number;
  v: number; // м/с вдоль трассы (встречные — отрицательная)
  hit: boolean;
  /** Порог интенсивности: преграда активна только если intensity ≥ этого. */
  threshold: number;
  /** Near-miss уже засчитан — пролёт впритирку даёт бонус один раз. */
  grazed?: boolean;
  /** Снесена турбо-машиной: летит по баллистике, столкновений больше нет. */
  launched?: boolean;
  lt0?: number; // локальное время запуска
  lp0?: THREE.Vector3; // мировая позиция в момент сноса
  lv0?: THREE.Vector3; // стартовая скорость разлёта
}

export class Traffic {
  readonly root = new THREE.Group();
  private obstacles: Obstacle[] = [];
  private pileGeo = new THREE.IcosahedronGeometry(1, 0);
  private pileMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab });
  private intensity = 0.6; // 0 — минимум преград, 1 — весь сгенерированный поток

  /**
   * Двунаправленная интенсивность: высокая активирует больше машин (веселее
   * на харде), низкая убирает лишние (не справляешься — меньше преград).
   */
  setIntensity(x: number) { this.intensity = Math.max(0, Math.min(1, x)); }

  constructor(level: Level, blocks: Blocks, diff: Difficulty) {
    const [iMin, iMax] = DIFF_INTERVAL[diff];
    let t = 10 + Math.random() * 5;
    while (t < level.durationSec - 6) {
      const meetDist = level.distAt(t);
      // полоса, свободная от блоков вокруг точки встречи
      const used = blocks.lanesNear(meetDist, 18);
      const free = [-1, 0, 1].filter((l) => !used.has(l));
      if (free.length) {
        const lane = free[Math.floor(Math.random() * free.length)];
        // порог: ~40% преград «ядро» (видны всегда), остальные — за интенсивностью
        const threshold = Math.random() < 0.4 ? 0 : 0.4 + Math.random() * 0.6;
        const r = Math.random();
        if (r < 0.45) this.spawnCar('oncoming', level, lane, meetDist, t, threshold);
        else if (r < 0.8) this.spawnCar('slow', level, lane, meetDist, t, threshold);
        else this.spawnPile(lane, meetDist, t, threshold);
      }
      t += iMin + Math.random() * (iMax - iMin);
    }
  }

  private spawnCar(
    kind: 'oncoming' | 'slow', level: Level, lane: number,
    meetDist: number, tMeet: number, threshold: number,
  ) {
    const car = buildCar({
      color: VAZ_COLORS[Math.floor(Math.random() * VAZ_COLORS.length)],
      lightsOn: true,
      beam: false,
    });
    const v = kind === 'oncoming' ? -(8 + Math.random() * 5) : level.speedAt(tMeet) * (0.45 + Math.random() * 0.15);
    if (kind === 'oncoming') car.rotation.y = Math.PI;
    car.visible = false;
    this.root.add(car);
    this.obstacles.push({ kind, group: car, lane, meetDist, tMeet, v, hit: false, threshold });
  }

  private spawnPile(lane: number, meetDist: number, tMeet: number, threshold: number) {
    const pile = new THREE.Mesh(this.pileGeo, this.pileMat);
    pile.scale.set(1.3 + Math.random() * 0.5, 0.65, 1.1 + Math.random() * 0.4);
    pile.rotation.y = Math.random() * Math.PI;
    pile.visible = false;
    this.root.add(pile);
    this.obstacles.push({ kind: 'pile', group: pile, lane, meetDist, tMeet, v: 0, hit: false, threshold });
  }

  /**
   * Двигает преграды, ловит столкновения и near-miss (пролёт впритирку).
   * Возвращает {collided, grazed} — въезд в этом кадре и/или near-miss.
   */
  update(t: number, level: Level, carDist: number, carWorldX: number, turbo = false):
    { collided: Obstacle | null; grazed: Obstacle | null; knocked: Obstacle | null } {
    let collided: Obstacle | null = null;
    let grazed: Obstacle | null = null;
    let knocked: Obstacle | null = null;
    for (const o of this.obstacles) {
      // снесённые турбо: свободный баллистический разлёт, без столкновений
      if (o.launched) {
        const tau = t - o.lt0!;
        const p = o.lp0!, v = o.lv0!;
        o.group.position.set(p.x + v.x * tau, p.y + v.y * tau - 0.5 * 22 * tau * tau, p.z + v.z * tau);
        o.group.rotation.x += 0.4;
        o.group.rotation.z += 0.25;
        o.group.visible = tau < 2.5 && o.group.position.y > -8;
        continue;
      }
      // прореженные интенсивностью — невидимы и без столкновения
      if (o.threshold > this.intensity) { o.group.visible = false; continue; }
      const pos = o.meetDist + o.v * (t - o.tMeet);
      const visible = pos > carDist - 35 && pos < carDist + 220;
      o.group.visible = visible;
      if (!visible) continue;
      const x = level.curveAt(pos) + o.lane * LANE_X;
      const y = level.heightAt(pos) + (o.kind === 'pile' ? 0.35 : 0);
      o.group.position.set(x, y, -pos);
      if (o.kind !== 'pile') {
        const dir = (level.curveAt(pos + 2) - level.curveAt(pos - 2)) / 4;
        o.group.rotation.y = -Math.atan(dir) + (o.kind === 'oncoming' ? Math.PI : 0);
      }
      const dz = Math.abs(pos - carDist);
      const dx = Math.abs(x - carWorldX);
      if (!o.hit && dz < 2.2 && dx < 1.4) {
        o.hit = true;
        if (turbo) {
          // машина-поезд: сносим преграду в полёт (вверх-вбок-назад), без штрафа
          o.launched = true;
          o.lt0 = t;
          o.lp0 = new THREE.Vector3(x, y, -pos);
          o.lv0 = new THREE.Vector3((x - carWorldX) * 4 + (Math.random() - 0.5) * 6, 9 + Math.random() * 4, 15);
          knocked = o;
        } else {
          collided = o;
        }
      } else if (!o.hit && !o.grazed && dz < 2.0 && dx >= 1.4 && dx < 2.5) {
        // пролетел рядом, но не задел — риск вознаграждается
        o.grazed = true;
        grazed = o;
      }
    }
    return { collided, grazed, knocked };
  }

  dispose() {
    this.root.traverse((obj) => {
      // общие геометрии машины делятся всеми инстансами — не диспозить
      if (obj instanceof THREE.Mesh && obj.geometry !== this.pileGeo
          && !SHARED_CAR_GEOS.has(obj.geometry)) obj.geometry.dispose();
    });
    this.pileGeo.dispose();
  }
}
