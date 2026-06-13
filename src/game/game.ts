import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Player } from 'midi-gen/audio';
import { IS_MOBILE } from '../platform';
import { World, THEMES, type WorldTheme } from './world';
import { comboPhrase } from './phrases';
import { buildCar } from './car';
import {
  Blocks, LANE_COLORS, LANE_CSS, POWER_COLOR, POWER_CSS,
  type Difficulty, type BlockExtras,
} from './blocks';
import { makeGate } from './gate';
import { Particles } from './particles';
import { Traffic } from './traffic';
import { Sfx } from './sfx';
import type { Level } from './level';
import type { Song } from 'midi-gen/core';

const STEER_RANGE = 3.2;

export class Game {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private car: THREE.Group;
  private blocks: Blocks;
  private traffic: Traffic;
  private invulnUntil = -1; // после удара — 1.5 с неуязвимости
  private particles = new Particles();
  private shake = 0;
  readonly sfx = new Sfx();
  private hud: HTMLDivElement;
  private fx: HTMLDivElement;
  private feverEdge: HTMLDivElement;
  private comboBar: HTMLDivElement;
  private comboBarFill: HTMLDivElement;
  private pointerLocked = false;
  score = 0;
  combo = 0;
  maxCombo = 0;
  collected = 0;
  bonusNotes = 0; // валюта сверх собранных блоков: джекпоты, мистери
  // статы заезда для миссий
  magnetsGot = 0;
  mysteryGot = 0;
  goldGot = 0;
  private lastCrashT = 0;
  noCrashSec = 0; // максимальный отрезок без аварии
  perfects = 0; // сколько собрано в центре полосы — для grade-фидбека
  // DDA-интенсивность: кольцо последних попаданий/промахов + комбо.
  // Двунаправленно: жжёшь — гуще блоки и трафик, мажешь — реже.
  private hitRing: number[] = [];
  private intensity = 0.6;
  private missStreak = 0;
  private missLimit: number;
  /** Fever-уровни: x15/x30/x50 комбо → множитель ×2/×3/×4. */
  private feverLevel = 0;
  private get fever() { return this.feverLevel > 0; }
  private magnetUntil = -1; // время музыки, до которого активен магнит
  private doubleUntil = -1; // время музыки, до которого активен ×2 за пикап
  private shielded = false; // щит: следующая авария без штрафа
  private hitStop = 0; // сек заморозки мира — продаёт вес удара
  private bloomPass: UnrealBloomPass | null = null;
  private bpm: number;
  private bestScore: number; // глобальный рекорд — призрак-цель в HUD
  private recordBroken = false;
  private themeIndex = 0; // клавиша 0 перебирает темы оформления на лету
  private tailMat: THREE.MeshStandardMaterial | null = null;
  private tailGlows: THREE.Sprite[] = []; // ореолы свечения фар
  private fpsEMA = 60; // сглаженный FPS для дебаг-лога (НЕ УДАЛЯТЬ — нужен до релиза)
  private logAcc = 0; // аккумулятор для лога раз в секунду
  private prevSpeed = 0; // для определения торможения (яркость задней фары)
  // финиш: камера остаётся у ворот, машина катится по инерции и плавно тормозит
  private finished = false;
  private coastV = 0;
  private coastDist = 0;
  private finishNotified = false;
  onFinish?: () => void;
  get blocksTotal() { return this.blocks.total; }
  private mouseX = 0; // -1..1
  private carX = 0;
  private firstPerson = false;
  paused = false;
  private tEst = 0; // сглаженные часы музыки
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    song: Song,
    private level: Level,
    private player: Player,
    diff: Difficulty = 'norm',
    private audioOffset = 0, // сек; калибровка из меню
    extras: BlockExtras & {
      lucky?: boolean; best?: number; carColor?: number; theme?: WorldTheme;
    } = { gold: false, mystery: 0 },
  ) {
    this.missLimit = diff === 'hard' ? 2 : 3;
    this.bpm = song.bpm;
    this.bestScore = extras.best ?? 0;
    this.car = buildCar({ color: extras.carColor ?? 0x6b1220 });
    this.world = new World(
      (z) => level.heightAt(-z), (z) => level.curveAt(-z), extras.theme,
    );
    if (extras.theme) this.themeIndex = Math.max(0, THEMES.indexOf(extras.theme));
    // кеш материала задней фары (обе фары делят один материал) и glow-ореолов
    const tailMesh = this.car.getObjectByName('taillight') as THREE.Mesh | null;
    this.tailMat = (tailMesh?.material as THREE.MeshStandardMaterial) ?? null;
    this.car.traverse((o) => {
      if (o.name === 'tailglow' && o instanceof THREE.Sprite) this.tailGlows.push(o);
    });
    this.blocks = new Blocks(song, level, diff, extras);
    // название темы — короткий ярлык новизны на старте
    if (extras.theme)
      setTimeout(() => {
        if (!this.disposed) this.pop(extras.theme!.name, 'pop-theme');
      }, 500);
    // удачный заезд объявляем, когда машина уже едет
    if (extras.lucky)
      setTimeout(() => {
        if (!this.disposed) this.pop('🔥 УДАЧНЫЙ ЗАЕЗД! НАГРАДЫ ×1.5', 'pop-combo pop-mega');
      }, 1200);
    this.traffic = new Traffic(level, this.blocks, diff);
    this.world.scene.add(this.blocks.mesh, this.particles.points, this.traffic.root);

    // ворота старта и финиша поперёк дороги
    for (const [label, color, css, d] of [
      ['СТАРТ', 0x22ffee, '#22ffee', level.distAt(1.2)],
      ['ФИНИШ', 0xff44ff, '#ff44ff', level.distAt(level.durationSec - 0.4)],
    ] as const) {
      const gate = makeGate(label, color, css);
      const dir = (level.curveAt(d + 2) - level.curveAt(d - 2)) / 4;
      gate.position.set(level.curveAt(d), level.heightAt(d), -d);
      gate.rotation.y = -Math.atan(dir);
      this.world.scene.add(gate);
    }
    // телефон: без antialias/bloom, pixelRatio ниже — GPU и так впритык.
    // десктоп кап 1.5 (а не 2): на retina 2x = 4x пикселей под bloom — тяжело,
    // и тяжёлый live-синтез конкурирует за CPU → запас спасает от заиканий звука
    this.renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.5 : 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);

    if (!IS_MOBILE) {
      // bloom: светится только яркое — неон-блоки, фонари, окна
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.world.scene, this.camera));
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.82,
      );
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(new OutputPass());
    }

    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);
    this.fx = document.createElement('div');
    this.fx.className = 'fx-layer';
    container.appendChild(this.fx);
    this.feverEdge = document.createElement('div');
    this.feverEdge.className = 'fever-edge';
    container.appendChild(this.feverEdge);
    this.comboBar = document.createElement('div');
    this.comboBar.className = 'combo-bar';
    this.comboBarFill = document.createElement('div');
    this.comboBar.appendChild(this.comboBarFill);
    container.appendChild(this.comboBar);

    this.world.scene.add(this.car);

    addEventListener('mousemove', this.onMouse);
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKey);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.renderer.domElement.addEventListener('click', this.grabPointer);
    // палец = руль: абсолютная позиция по ширине экрана
    this.renderer.domElement.addEventListener('touchstart', this.onTouch, { passive: false });
    this.renderer.domElement.addEventListener('touchmove', this.onTouch, { passive: false });
  }

  private onTouch = (e: TouchEvent) => {
    e.preventDefault(); // без скролла и pull-to-refresh
    const touch = e.touches[0];
    if (touch) this.mouseX = (touch.clientX / innerWidth) * 2 - 1;
  };

  /** Захват курсора: машина и есть курсор, мышь не улетает из окна. */
  grabPointer = () => {
    if (!this.pointerLocked)
      this.renderer.domElement.requestPointerLock()?.catch?.(() => {
        /* нет поддержки — остаёмся на абсолютной мыши */
      });
  };

  private onLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
  };

  /** Отдать курсор (пауза: ползунки требуют мышь). */
  releasePointer() {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyC') this.firstPerson = !this.firstPerson; // физ. клавиша — любая раскладка
    if (e.code === 'Digit0' || e.code === 'Numpad0') {
      // перебор тем оформления на лету — посмотреть снег/дождь/рассвет/закат
      this.themeIndex = (this.themeIndex + 1) % THEMES.length;
      const th = THEMES[this.themeIndex];
      this.world.applyTheme(th);
      this.pop(`🎨 ${th.name}`, 'pop-theme');
    }
  };

  /** Цветная вспышка у машины. */
  private flash(css: string) {
    const el = document.createElement('div');
    el.className = 'flash';
    el.style.background = `radial-gradient(circle, ${css}55 0%, transparent 70%)`;
    el.style.left = `${48 + Math.random() * 4}%`;
    this.fx.appendChild(el);
    setTimeout(() => el.remove(), 300);
  }

  /** Всплывашка над машиной (машина всегда у центра-низа экрана). */
  private pop(text: string, cls: string) {
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    el.style.left = `${50 + (Math.random() * 14 - 7)}%`;
    el.style.setProperty('--rot', `${Math.random() * 22 - 11}deg`);
    this.fx.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }

  /**
   * Вехи комбо. true — названная веха (вспышка+тряска): на ней показываем
   * случайную мотивирующую фразу из пула (тир по величине комбо).
   */
  private popFx(): boolean {
    const c = this.combo;
    const named = c === 5 || c === 10 || c === 20 || c === 30 || c === 50
      || (c > 50 && c % 25 === 0);
    if (named) {
      const cls = c >= 30 ? 'pop-combo pop-mega' : c >= 10 ? 'pop-combo pop-super' : 'pop-combo';
      this.pop(`x${c} ${comboPhrase(c)}!`, cls);
      return true;
    }
    if (c > 1 && c % 5 === 0) this.pop(`x${c}`, 'pop-combo');
    return false;
  }

  /** Счёт в HUD «вздрагивает» вместо всплывашки «+очки» на каждый блок. */
  private scoreBump() {
    this.hud.classList.remove('bump');
    void this.hud.offsetWidth; // перезапуск CSS-анимации
    this.hud.classList.add('bump');
  }

  /**
   * Срыв: падение на предыдущую веху (x30 → x20), не в ноль — качели
   * «всё-или-ничего» выбивают из потока. Fever гаснет, только если комбо
   * упало ниже порога.
   */
  private breakCombo() {
    if (this.combo > 50) {
      this.combo = 50 + Math.floor((this.combo - 1 - 50) / 25) * 25;
    } else {
      let down = 0;
      for (const m of [5, 10, 15, 20, 30, 50]) if (m < this.combo) down = m;
      this.combo = down;
    }
    this.syncFever();
  }

  /**
   * Fever-уровни и музыка следуют за комбо: x15/x30/x50 → fever I/II/III
   * (×2/×3/×4), комбо ≥8/≥16 открывают слои трека. Рост уровня — событие,
   * на подходе к fever края экрана плавно разгораются (предвкушение видно).
   */
  private syncFever() {
    const lvl = this.combo >= 50 ? 3 : this.combo >= 30 ? 2 : this.combo >= 15 ? 1 : 0;
    if (lvl > this.feverLevel) {
      this.feverLevel = lvl;
      this.pop(
        lvl === 1 ? '🔥 FEVER x2' : lvl === 2 ? '🔥🔥 FEVER II x3' : '🔥🔥🔥 FEVER III x4',
        'pop-combo pop-mega',
      );
      this.flash('#ff44ff');
      this.shake = Math.max(this.shake, 0.6);
    } else this.feverLevel = lvl;
    this.feverEdge.className = `fever-edge${lvl ? ` on lvl${lvl}` : ''}`;
    // пре-fever разогрев: x10–14 — края тлеют всё ярче
    this.feverEdge.style.opacity =
      lvl === 0 && this.combo >= 10 ? String(((this.combo - 9) / 6) * 0.5) : '';
    // музыкальные слои: база / +chords·counter (x8) / всё (x16)
    const tier = this.combo >= 16 ? 2 : this.combo >= 8 ? 1 : 0;
    (this.player as Player & { setTier?: (t: number) => void }).setTier?.(tier);
  }

  /** Кольцо попал/мимо для hit-rate (вызывается на каждый блок/промах). */
  private trackHit(hit: boolean) {
    this.hitRing.push(hit ? 1 : 0);
    if (this.hitRing.length > 22) this.hitRing.shift();
  }

  /**
   * Адаптивная интенсивность по hit-rate + комбо. Высокая — гуще блоки и
   * трафик (на харде / когда жжёшь — веселее), низкая — реже и то и другое
   * (явно не справляешься — меньше преград). Финал трека эскалирует вверх.
   * Тайминги-окна не трогаем — доверие к ритму.
   */
  private updateIntensity(t: number, dt: number) {
    let target: number;
    if (this.hitRing.length < 8) {
      target = 0.6; // мало данных — нейтральная плотность
    } else {
      const rate = this.hitRing.reduce((a, b) => a + b, 0) / this.hitRing.length;
      // hit-rate 0.45→0.95 → 0..1, плюс вклад комбо (до +0.25)
      const perf = Math.max(0, Math.min(1, (rate - 0.45) / 0.5));
      const comboBoost = Math.min(this.combo / 25, 1) * 0.25;
      target = Math.max(0.35, Math.min(1, perf * 0.8 + 0.2 + comboBoost));
    }
    // финальная эскалация: последние 20% трека тянем к максимуму (кульминация)
    const frac = t / this.level.durationSec;
    if (frac > 0.8) target = Math.max(target, 0.8 + (frac - 0.8) / 0.2 * 0.2);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.8); // плавно ~1.3с
    this.blocks.setDensity(0.55 + this.intensity * 0.45); // 0.55..1.0
    this.traffic.setIntensity(this.intensity);
  }

  /** Церемония рекорда на финише: золотой салют вокруг машины. */
  celebrate() {
    const gold = new THREE.Color('#ffd24d');
    const { x, y, z } = this.car.position;
    for (let k = 0; k < 3; k++)
      setTimeout(() => {
        if (this.disposed) return;
        this.particles.burst(x + (Math.random() - 0.5) * 4, y + 1.5, z - 2 - k * 2, gold, 50);
        this.shake = Math.min(0.5, this.shake + 0.25);
      }, k * 220);
    this.flash('#ffd24d');
    this.sfx.jackpot();
  }

  private onMouse = (e: MouseEvent) => {
    if (this.pointerLocked) {
      // относительное движение, края «прилипают» — курсор не улетает
      this.mouseX = THREE.MathUtils.clamp(this.mouseX + e.movementX / 380, -1, 1);
    } else {
      this.mouseX = (e.clientX / innerWidth) * 2 - 1;
    }
  };

  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
  };

  start() {
    this.grabPointer(); // мы внутри клика «ПОЕХАЛИ» — жест есть
    this.clock.start();
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.tick(Math.min(this.clock.getDelta(), 0.05));
    };
    loop();
  }

  private tick(dt: number) {
    // hit-stop: мир замирает на пару кадров — удар обретает вес;
    // часы стоят, аудио уходит вперёд на <0.1с, мягкий ресинк догонит
    if (this.hitStop > 0 && !this.paused) {
      this.hitStop -= dt;
      this.particles.update(dt * 0.25); // искры еле живут — кадр не мёртвый
      if (this.composer) this.composer.render();
      else this.renderer.render(this.world.scene, this.camera);
      return;
    }
    // мастер-часы — позиция музыки, но сглаженная: positionSec() дрожит
    // (outputLatency в Chrome плавает кадр к кадру), напрямую машина дёргается.
    // Ведём свои часы по dt и мягко подтягиваем к аудио.
    if (!this.paused) {
      const reported = this.player.positionSec();
      this.tEst += dt;
      const err = reported - this.tEst;
      // огромный расход (>2с) = перезапуск/seek — только тогда жёсткий сброс.
      // иначе ВСЕГДА плавный слью без телепорта: коррекция капается ±60% хода,
      // чтобы заминка синтеза (резкий скачок позиции) не дёргала машину.
      if (Math.abs(err) > 2) {
        this.tEst = reported;
      } else {
        const maxCorr = 0.6 * dt; // не быстрее +60% / медленнее −40% реального
        this.tEst += THREE.MathUtils.clamp(err * 0.5, -maxCorr, maxCorr);
      }
    }
    const t = Math.max(0, this.tEst + this.audioOffset);

    // конец трека → фаза наката: своя интеграция вместо distAt
    if (!this.finished && t >= this.level.durationSec - 0.03) {
      this.finished = true;
      this.coastV = this.level.speedAt(this.level.durationSec - 0.2);
    }

    // задняя фара: тусклый ночной габарит, ярче при торможении/замедлении.
    // меняем и накал линзы, и мягкий ореол (растёт при стопе) — «в тумане»
    if (this.tailMat) {
      const v = this.level.speedAt(t);
      const decel = Math.max(0, (this.prevSpeed - v) / Math.max(dt, 1e-3));
      this.prevSpeed = v;
      const brake = this.finished ? 1 : Math.min(decel / 3.5, 1); // 0..1
      const target = 0.8 + brake * 2.8;
      this.tailMat.emissiveIntensity +=
        (target - this.tailMat.emissiveIntensity) * Math.min(1, dt * 9);
      const glow = 0.28 + brake * 0.4;
      const sc = 1 + brake * 0.45;
      for (const s of this.tailGlows) {
        s.material.opacity += (glow - s.material.opacity) * Math.min(1, dt * 9);
        s.scale.set(1.15 * sc, 0.85 * sc, 1);
      }
    }
    let dist: number;
    if (this.finished && !this.paused) {
      this.coastDist += this.coastV * dt;
      this.coastV *= Math.exp(-1.1 * dt); // плавное торможение
      dist = this.level.totalDist + this.coastDist;
      if (this.coastV < 0.8 && !this.finishNotified) {
        this.finishNotified = true;
        this.onFinish?.();
      }
    } else if (this.finished) {
      dist = this.level.totalDist + this.coastDist;
    } else {
      dist = this.level.distAt(t);
    }

    // руление мышью с плавным догоном и креном
    // быстрый догон курсора (ритм-игра), вес — в крене и довороте носа
    const target = THREE.MathUtils.clamp(this.mouseX, -1, 1) * STEER_RANGE;
    const prevX = this.carX;
    this.carX = THREE.MathUtils.damp(this.carX, target, 14, dt);
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
    this.car.rotation.y = -Math.atan(roadDir) + THREE.MathUtils.clamp(-vx * 0.035, -0.4, 0.4);
    this.car.rotation.z = THREE.MathUtils.clamp(vx * 0.014, -0.14, 0.14);

    // микро-тряска от сбора, быстро гаснет
    this.shake *= Math.exp(-7 * dt);
    const shX = (Math.random() - 0.5) * this.shake * 0.3;
    const shY = (Math.random() - 0.5) * this.shake * 0.22;

    if (this.finished) {
      // камера остаётся у финишных ворот и провожает машину взглядом
      const fd = this.level.totalDist;
      const camPos = new THREE.Vector3(
        this.level.curveAt(fd - 8) * 0.7 + this.level.curveAt(fd) * 0.3,
        this.level.heightAt(fd - 8) + 4.0,
        -(fd - 8.5),
      );
      this.camera.position.lerp(camPos, 1 - Math.exp(-3 * dt));
      this.camera.lookAt(cx + this.carX, y + 0.8, -dist);
    } else if (this.firstPerson) {
      // вид водителя: камера у лобового, чуть перед стеклом (стекло непрозрачное)
      this.camera.position.set(cx + this.carX + shX * 0.5, y + 1.4 + shY * 0.5, -dist - 0.95);
      const look = 22;
      this.camera.lookAt(
        this.level.curveAt(dist + look) + this.carX,
        this.level.heightAt(dist + look) + 1.25,
        -dist - look,
      );
    } else {
      // сзади-сверху, камера держится оси дороги
      const camY = this.level.heightAt(Math.max(0, dist - 7.5)) + 4.2;
      const camTarget = new THREE.Vector3(
        this.level.curveAt(Math.max(0, dist - 7.5)) + this.carX * 0.6, camY, -dist + 7.5,
      );
      this.camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt));
      this.camera.position.x += shX;
      this.camera.position.y += shY;
      this.camera.lookAt(
        this.level.curveAt(dist + 8) + this.carX * 0.8, y + 1.0, -dist - 8,
      );
    }
    this.particles.update(dt);

    // блоки: сбор по позиции машины (+притяжение при активном магните)
    const magnetActive = t < this.magnetUntil;
    this.blocks.update(
      dist, cx + this.carX, t, dt, this.fever, magnetActive,
      (b, perfect) => {
        if (b.kind === 'magnet') {
          const power = b.power ?? 'magnet';
          this.magnetsGot++; // засчитываем как пойманный пикап (миссия «магниты»)
          this.score += 50;
          if (power === 'shield') {
            this.shielded = true;
            this.pop('🛡 ЩИТ!', 'pop-combo pop-super');
          } else if (power === 'double') {
            this.doubleUntil = t + 10;
            this.pop('✖2 ОЧКИ x2!', 'pop-combo pop-super');
          } else {
            this.magnetUntil = t + 8;
            this.pop('🧲 МАГНИТ!', 'pop-combo pop-super');
          }
          this.particles.burst(b.x, b.y, -b.dist, POWER_COLOR[power], 30);
          this.flash(POWER_CSS[power]);
          this.shake = Math.min(0.5, this.shake + 0.2);
          this.scoreBump();
          return;
        }
        if (b.kind === 'gold') {
          // джекпот: куш растёт с комбо — поймать на высоком стрике вкуснее
          this.goldGot++;
          const pts = Math.round((100 + this.combo * 6) * (1 + this.feverLevel));
          this.score += pts;
          this.bonusNotes += 25;
          this.pop(`💰 ДЖЕКПОТ +${pts}!`, 'pop-combo pop-mega');
          this.flash('#ffd24d');
          this.particles.burst(b.x, b.y, -b.dist, new THREE.Color('#fff3a0'), 60);
          this.shake = Math.min(0.6, this.shake + 0.5);
          this.hitStop = 0.07;
          this.sfx.jackpot();
          this.scoreBump();
          return;
        }
        if (b.kind === 'mystery') {
          // содержимое неизвестно до подбора — variable-ratio в чистом виде
          this.mysteryGot++;
          const r = Math.random();
          if (r < 0.45) {
            const pts = Math.round((40 + this.combo * 4) * (1 + this.feverLevel));
            this.score += pts;
            this.pop(`❓ +${pts} ОЧКОВ`, 'pop-combo pop-mystery');
          } else if (r < 0.7) {
            this.magnetUntil = t + 8;
            this.pop('❓ 🧲 МАГНИТ!', 'pop-combo pop-mystery');
          } else if (r < 0.9) {
            this.bonusNotes += 15;
            this.pop('❓ ♪ +15 НОТ', 'pop-combo pop-mystery');
          } else {
            const pts = Math.round(250 * (1 + this.feverLevel));
            this.score += pts;
            this.pop(`❓ 💰 КУШ +${pts}!`, 'pop-combo pop-mega');
          }
          this.flash('#ffffff');
          this.particles.burst(b.x, b.y, -b.dist, new THREE.Color('#ffffff'), 50);
          this.shake = Math.min(0.5, this.shake + 0.3);
          this.sfx.mystery();
          this.scoreBump();
          return;
        }
        this.missStreak = 0;
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.collected++;
        this.trackHit(true);
        // grading: PERFECT (центр полосы) даёт +20% и золотую искру
        if (perfect) this.perfects++;
        const grade = perfect ? 1.2 : 1;
        const dbl = t < this.doubleUntil ? 2 : 1; // пикап ×2
        const pts = Math.round(
          (10 + (b.vel / 127) * 10) * b.count *
          (1 + Math.min(this.combo, 50) * 0.06) * (1 + this.feverLevel) * grade * dbl,
        );
        this.score += pts;
        this.sfx.collect(this.combo, this.fever, b.count);
        this.scoreBump();
        const milestone = this.popFx();
        // искры — на каждый блок; PERFECT добавляет золотую вспышку искр
        this.particles.burst(b.x, b.y, -b.dist, LANE_COLORS[b.lane + 1], 12 + b.count * 6);
        if (perfect) {
          this.particles.burst(b.x, b.y + 0.3, -b.dist, new THREE.Color('#ffe9a0'), 8);
          if (!milestone && this.combo % 3 === 0) this.pop('PERFECT', 'pop-perfect');
        }
        if (milestone) {
          this.flash(LANE_CSS[b.lane + 1]);
          this.shake = Math.min(0.45, this.shake + 0.3);
        } else if (b.count > 1) {
          this.shake = Math.min(0.45, this.shake + 0.04 * b.count);
        }
        this.syncFever();
      },
      () => {
        // прощающее комбо: одиночный промах — тишина
        this.trackHit(false);
        this.missStreak++;
        if (this.missStreak >= this.missLimit && this.combo > 0) {
          this.missStreak = 0;
          this.breakCombo();
          this.sfx.miss();
        }
      },
    );

    // адаптивная интенсивность: плотность блоков и трафика по игре + финал
    if (!this.finished) this.updateIntensity(t, dt);

    // трафик: столкновение = откат комбо и штраф; near-miss = бонус за риск
    const { collided: hitObs, grazed } = this.traffic.update(t, this.level, dist, cx + this.carX);
    if (grazed && !hitObs) {
      this.score += 25;
      this.bonusNotes += 2;
      this.pop('+25 РИСК!', 'pop-combo pop-risk');
      this.scoreBump();
    }
    if (hitObs && t > this.invulnUntil) {
      this.invulnUntil = t + 1.5;
      if (this.shielded) {
        // щит поглощает удар: комбо и очки целы, без штрафа
        this.shielded = false;
        this.pop('🛡 ЩИТ СПАС!', 'pop-combo pop-super');
        this.flash('#44d6ff');
        this.shake = Math.min(0.5, this.shake + 0.3);
        this.particles.burst(this.car.position.x, this.car.position.y + 0.8,
          this.car.position.z, new THREE.Color('#44d6ff'), 30);
      } else {
        this.missStreak = 0;
        this.breakCombo();
        this.score = Math.max(0, this.score - 50);
        this.sfx.crash();
        this.pop('💥', 'pop-combo pop-crash');
        this.flash('#ff4433');
        this.shake = 0.8;
        this.hitStop = 0.09;
        this.lastCrashT = t;
        // авария — явный сигнал «тяжело»: роняем интенсивность
        this.trackHit(false); this.trackHit(false); this.trackHit(false);
      }
    }
    // самый длинный отрезок без аварии — для миссии «N с без аварий»
    if (!this.finished) this.noCrashSec = Math.max(this.noCrashSec, t - this.lastCrashT);

    // микроцель: полоска до следующей вехи комбо
    const milestones = [0, 5, 10, 15, 20, 30, 50];
    let lo = 0, hi = 5;
    if (this.combo >= 50) { lo = 50 + Math.floor((this.combo - 50) / 25) * 25; hi = lo + 25; }
    else {
      for (let i = 0; i < milestones.length - 1; i++)
        if (this.combo >= milestones[i] && this.combo < milestones[i + 1]) {
          lo = milestones[i]; hi = milestones[i + 1];
        }
    }
    this.comboBarFill.style.width = `${((this.combo - lo) / (hi - lo)) * 100}%`;

    // рекорд-призрак: погоня видна в реальном времени, не на результатах
    let recPart = '';
    if (this.bestScore > 0 && !this.finished) {
      if (this.score > this.bestScore) {
        if (!this.recordBroken) {
          this.recordBroken = true;
          this.pop('🏆 РЕКОРД ПОБИТ!', 'pop-combo pop-mega');
          this.flash('#ffd24d');
          this.shake = Math.max(this.shake, 0.5);
        }
        recPart = ` · 🏆 +${this.score - this.bestScore}`;
      } else recPart = ` · 🏆 −${this.bestScore - this.score}`;
    }

    const kmh = Math.round(this.level.speedAt(t) * 3.6);
    const fmt = (s: number) =>
      `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    this.hud.textContent =
      `${this.score} очков${this.combo > 1 ? ` · x${this.combo}` : ''}` +
      `${this.fever ? ` · 🔥x${1 + this.feverLevel}` : ''}` +
      `${magnetActive ? ` · 🧲${Math.ceil(this.magnetUntil - t)}с` : ''}` +
      `${t < this.doubleUntil ? ` · ✖2 ${Math.ceil(this.doubleUntil - t)}с` : ''}` +
      `${this.shielded ? ' · 🛡' : ''}` +
      recPart +
      ` · ${kmh} км/ч · ${fmt(t)} / ${fmt(this.level.durationSec)}`;

    // неон дышит в бит: bloom качается с каждым ударом, в fever сильнее
    if (this.bloomPass && !this.paused) {
      const phase = (t * this.bpm / 60) % 1;
      const env = Math.max(0, 1 - phase * 3.2);
      this.bloomPass.strength = 0.5 + 0.14 * env * env * (1 + this.feverLevel * 0.35);
    }

    this.world.update(dt, this.car.position);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.world.scene, this.camera);

    // дебаг FPS + скорость раз в секунду (нужен до релиза — НЕ УДАЛЯТЬ)
    if (dt > 0) this.fpsEMA += (1 / dt - this.fpsEMA) * 0.1;
    this.logAcc += dt;
    if (this.logAcc >= 1 && !this.finished && !this.paused) {
      this.logAcc = 0;
      console.log(`[perf] fps=${Math.round(this.fpsEMA)} speed=${kmh}км/ч t=${t.toFixed(1)}`);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('mousemove', this.onMouse);
    removeEventListener('resize', this.onResize);
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.renderer.domElement.removeEventListener('touchstart', this.onTouch);
    this.renderer.domElement.removeEventListener('touchmove', this.onTouch);
    if (this.pointerLocked) document.exitPointerLock();
    this.blocks.dispose();
    this.traffic.dispose();
    this.particles.dispose();
    this.sfx.dispose();
    this.world.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.remove();
    this.fx.remove();
    this.feverEdge.remove();
    this.comboBar.remove();
  }
}
