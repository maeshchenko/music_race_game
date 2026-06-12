import * as THREE from 'three';
import { buildCar } from './car';
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

const DIFF_INTERVAL: Record<Difficulty, [number, number]> = {
  light: [3.5, 5.5],
  norm: [2.2, 3.8],
  hard: [1.5, 2.8],
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
}

export class Traffic {
  readonly root = new THREE.Group();
  private obstacles: Obstacle[] = [];
  private pileGeo = new THREE.IcosahedronGeometry(1, 0);
  private pileMat = new THREE.MeshLambertMaterial({ color: 0x9aa1ab });

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
        const r = Math.random();
        if (r < 0.45) this.spawnCar('oncoming', level, lane, meetDist, t);
        else if (r < 0.8) this.spawnCar('slow', level, lane, meetDist, t);
        else this.spawnPile(lane, meetDist, t);
      }
      t += iMin + Math.random() * (iMax - iMin);
    }
  }

  private spawnCar(kind: 'oncoming' | 'slow', level: Level, lane: number, meetDist: number, tMeet: number) {
    const car = buildCar({
      color: VAZ_COLORS[Math.floor(Math.random() * VAZ_COLORS.length)],
      lightsOn: true,
      beam: false,
    });
    const v = kind === 'oncoming' ? -(8 + Math.random() * 5) : level.speedAt(tMeet) * (0.45 + Math.random() * 0.15);
    if (kind === 'oncoming') car.rotation.y = Math.PI;
    car.visible = false;
    this.root.add(car);
    this.obstacles.push({ kind, group: car, lane, meetDist, tMeet, v, hit: false });
  }

  private spawnPile(lane: number, meetDist: number, tMeet: number) {
    const pile = new THREE.Mesh(this.pileGeo, this.pileMat);
    pile.scale.set(1.3 + Math.random() * 0.5, 0.65, 1.1 + Math.random() * 0.4);
    pile.rotation.y = Math.random() * Math.PI;
    pile.visible = false;
    this.root.add(pile);
    this.obstacles.push({ kind: 'pile', group: pile, lane, meetDist, tMeet, v: 0, hit: false });
  }

  /** Возвращает преграду, в которую въехали в этом кадре (или null). */
  update(t: number, level: Level, carDist: number, carWorldX: number): Obstacle | null {
    let collided: Obstacle | null = null;
    for (const o of this.obstacles) {
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
      if (!o.hit && Math.abs(pos - carDist) < 2.2 && Math.abs(x - carWorldX) < 1.4) {
        o.hit = true;
        collided = o;
      }
    }
    return collided;
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.geometry !== this.pileGeo) obj.geometry.dispose();
    });
    this.pileGeo.dispose();
  }
}
