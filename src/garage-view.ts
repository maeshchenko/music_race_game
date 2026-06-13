import * as THREE from 'three';
import { buildCar, SHARED_CAR_GEOS } from './game/car';

/**
 * 3D-витрина гаража в стиле NFS Underground: машина на круглом пьедестале,
 * сама медленно крутится, мышью можно вращать (с инерцией). Цвет кузова
 * применяется мгновенно (пересборка машины — дёшево на клик).
 */
export class GarageView {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private spin = new THREE.Group();
  private car: THREE.Group | null = null;
  private raf = 0;
  private clock = new THREE.Clock();
  private angle = 0;
  private vel = 0;
  private dragging = false;
  private lastX = 0;
  private disposed = false;

  constructor(width: number, height: number, color: number) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none';
    this.canvas.style.cursor = 'grab';

    this.camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 100);
    this.camera.position.set(4.6, 2.1, 5.6);
    this.camera.lookAt(0, 0.65, 0);

    // свет: мягкая заливка + тёплый ключевой сверху + холодный контровой
    this.scene.add(new THREE.HemisphereLight(0x8090b4, 0x1a1c22, 0.85));
    const key = new THREE.SpotLight(0xfff0d4, 240, 24, 0.7, 0.6, 1.4);
    key.position.set(2.5, 9, 3.5);
    key.target.position.set(0, 0.5, 0);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.7);
    rim.position.set(-4, 3, -5);
    this.scene.add(rim);

    // пьедестал — круглая тумба + тёплое пятно-«прожектор» под машиной
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.95, 0.34, 56),
      new THREE.MeshStandardMaterial({ color: 0x16181e, roughness: 0.55, metalness: 0.45 }),
    );
    ped.position.y = -0.17;
    this.scene.add(ped);
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(2.65, 56),
      new THREE.MeshBasicMaterial({
        map: this.spotTexture(), transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.02;
    this.scene.add(pool);

    this.scene.add(this.spin);
    this.setColor(color);

    this.canvas.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);

    this.loop();
  }

  /** Тёплый радиальный «прожектор» пьедестала. */
  private spotTexture(): THREE.CanvasTexture {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const rg = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(255,200,120,0.55)');
    rg.addColorStop(0.5, 'rgba(255,165,77,0.22)');
    rg.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** Сменить цвет кузова — пересобираем машину (дёшево на клик). */
  setColor(color: number) {
    if (this.car) {
      this.spin.remove(this.car);
      this.car.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          if (!SHARED_CAR_GEOS.has(o.geometry)) o.geometry.dispose(); // общие — не трогать
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
    }
    this.car = buildCar({ color, lightsOn: true, beam: false });
    this.spin.add(this.car);
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.vel = 0;
    this.canvas.style.cursor = 'grabbing';
  };
  private onMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = (e.clientX - this.lastX) * 0.009;
    this.angle += dx;
    this.vel = dx;
    this.lastX = e.clientX;
  };
  private onUp = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.dragging) {
      // угол ведёт мышь
    } else if (Math.abs(this.vel) > 0.0016) {
      this.angle += this.vel; // инерция после броска
      this.vel *= 0.93;
    } else {
      this.angle += dt * 0.3; // сам медленно крутится
    }
    this.spin.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  };

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    this.car?.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (!SHARED_CAR_GEOS.has(o.geometry)) o.geometry.dispose(); // общие — не трогать
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
    this.canvas.remove();
  }
}
