import * as THREE from 'three';

/**
 * Пул искр для взрывов при сборе: один THREE.Points, мёртвые частицы
 * прячутся под мир. Без аллокаций в кадре.
 */
const N = 480;
const GRAVITY = 7;

export class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel = new Float32Array(N * 3);
  private life = new Float32Array(N); // 0 = мертва
  private head = 0;

  constructor() {
    this.pos = new Float32Array(N * 3).fill(-9999);
    this.col = new Float32Array(N * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
  }

  burst(x: number, y: number, z: number, color: THREE.Color, count = 16) {
    for (let k = 0; k < count; k++) {
      const i = this.head++ % N;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = 2 + Math.random() * 5;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = 2 + Math.random() * 4.5;
      this.vel[i * 3 + 2] = Math.sin(a) * r - 4; // сноп чуть вперёд, к движению
      this.life[i] = 0.5 + Math.random() * 0.4;
      this.col[i * 3] = color.r;
      this.col[i * 3 + 1] = color.g;
      this.col[i * 3 + 2] = color.b;
    }
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      this.vel[i * 3 + 1] -= GRAVITY * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
