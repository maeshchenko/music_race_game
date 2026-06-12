import * as THREE from 'three';
import type { Player } from 'midi-gen/audio';
import { World } from './world';
import { buildCar } from './car';
import type { Level } from './level';

const STEER_RANGE = 3.2;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private car = buildCar();
  private hud: HTMLDivElement;
  private mouseX = 0; // -1..1
  private carX = 0;
  private firstPerson = false;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    private level: Level,
    private player: Player,
  ) {
    this.world = new World((z) => level.heightAt(-z), (z) => level.curveAt(-z));
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);
    this.world.scene.add(this.car);

    addEventListener('mousemove', this.onMouse);
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyC') this.firstPerson = !this.firstPerson; // физ. клавиша — любая раскладка
  };

  private onMouse = (e: MouseEvent) => {
    this.mouseX = (e.clientX / innerWidth) * 2 - 1;
  };

  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  };

  start() {
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.tick(Math.min(this.clock.getDelta(), 0.05));
    };
    loop();
  }

  private tick(dt: number) {
    // мастер-часы — позиция музыки: дистанция и скорость следуют треку
    const t = this.player.positionSec();
    const dist = this.level.distAt(t);

    // руление мышью с плавным догоном и креном
    const target = THREE.MathUtils.clamp(this.mouseX, -1, 1) * STEER_RANGE;
    const prevX = this.carX;
    this.carX = THREE.MathUtils.damp(this.carX, target, 6, dt);
    const vx = (this.carX - prevX) / Math.max(dt, 1e-4);

    // позиция: ось дороги (повороты) + руление, рельеф + тангаж по уклону
    const cx = this.level.curveAt(dist);
    const roadDir = (this.level.curveAt(dist + 2) - this.level.curveAt(dist - 2)) / 4;
    const y = this.level.heightAt(dist);
    const yAhead = this.level.heightAt(dist + 2.4);
    this.car.position.set(cx + this.carX, y, -dist);
    // нос -z: вверх = отрицательный rx; демпфер сглаживает смену уклона
    this.car.rotation.x = THREE.MathUtils.damp(
      this.car.rotation.x, -Math.atan2(yAhead - y, 2.4), 5, dt,
    );
    // нос по касательной к дороге + доворот рулём
    this.car.rotation.y = -Math.atan(roadDir) + THREE.MathUtils.clamp(-vx * 0.05, -0.35, 0.35);
    this.car.rotation.z = THREE.MathUtils.clamp(vx * 0.02, -0.12, 0.12);

    if (this.firstPerson) {
      // вид водителя: камера у лобового, чуть перед стеклом (стекло непрозрачное)
      this.camera.position.set(cx + this.carX, y + 1.16, -dist - 0.95);
      const look = 22;
      this.camera.lookAt(
        this.level.curveAt(dist + look) + this.carX,
        this.level.heightAt(dist + look) + 1.1,
        -dist - look,
      );
    } else {
      // сзади-сверху, камера держится оси дороги
      const camY = this.level.heightAt(Math.max(0, dist - 7.5)) + 4.2;
      const camTarget = new THREE.Vector3(
        this.level.curveAt(Math.max(0, dist - 7.5)) + this.carX * 0.6, camY, -dist + 7.5,
      );
      this.camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt));
      this.camera.lookAt(
        this.level.curveAt(dist + 8) + this.carX * 0.8, y + 1.0, -dist - 8,
      );
    }

    const kmh = Math.round(this.level.speedAt(t) * 3.6);
    const fmt = (s: number) =>
      `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.hud.textContent = `${kmh} км/ч · ${fmt(t)} / ${fmt(this.level.durationSec)}`;

    this.world.update(dt, this.car.position);
    this.renderer.render(this.world.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('mousemove', this.onMouse);
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKey);
    this.world.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.remove();
  }
}
