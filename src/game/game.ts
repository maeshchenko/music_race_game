import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Player } from 'midi-gen/audio';
import { IS_MOBILE } from '../platform';
import { World } from './world';
import { buildCar } from './car';
import { Blocks, LANE_COLORS, LANE_CSS, type Difficulty, type BlockExtras } from './blocks';
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
  private car = buildCar();
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
  private missStreak = 0;
  private missLimit: number;
  /** Fever-уровни: x15/x30/x50 комбо → множитель ×2/×3/×4. */
  private feverLevel = 0;
  private get fever() { return this.feverLevel > 0; }
  private magnetUntil = -1; // время музыки, до которого активен магнит
  private hitStop = 0; // сек заморозки мира — продаёт вес удара
  private bloomPass: UnrealBloomPass | null = null;
  private bpm: number;
  private bestScore: number; // глобальный рекорд — призрак-цель в HUD
  private recordBroken = false;
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
    extras: BlockExtras & { lucky?: boolean; best?: number } = { gold: false, mystery: 0 },
  ) {
    this.missLimit = diff === 'hard' ? 2 : 3;
    this.bpm = song.bpm;
    this.bestScore = extras.best ?? 0;
    this.world = new World((z) => level.heightAt(-z), (z) => level.curveAt(-z));
    this.blocks = new Blocks(song, level, diff, extras);
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
    // телефон: без antialias/bloom, pixelRatio ниже — GPU и так впритык
    this.renderer = new THREE.WebGLRenderer({ antialias: !IS_MOBILE });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, IS_MOBILE ? 1.5 : 2));
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

  /** Вехи комбо. true — названная веха: ей положены вспышка и тряска. */
  private popFx(): boolean {
    const c = this.combo;
    if (c === 5) this.pop('x5 ПОЕХАЛИ!', 'pop-combo');
    else if (c === 10) this.pop('x10 СУПЕР!', 'pop-combo pop-super');
    else if (c === 20) this.pop('x20 ОГОНЬ!!', 'pop-combo pop-super');
    else if (c === 30) this.pop('x30 НЕОН!!!', 'pop-combo pop-mega');
    else if (c === 50) this.pop('x50 ЛЕГЕНДА!', 'pop-combo pop-mega');
    else if (c > 50 && c % 25 === 0) this.pop(`x${c} БЕЗУМИЕ!`, 'pop-combo pop-mega');
    else {
      if (c > 1 && c % 5 === 0) this.pop(`x${c}`, 'pop-combo');
      return false;
    }
    return true;
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
      if (Math.abs(err) > 0.3) {
        this.tEst = reported; // большой расход — жёсткий ресинк
        console.warn(`[clock] resync ${err.toFixed(3)}s @${reported.toFixed(1)}s`);
      } else this.tEst += err * Math.min(1, dt * 4); // иначе мягкая коррекция
    }
    const t = Math.max(0, this.tEst + this.audioOffset);

    // конец трека → фаза наката: своя интеграция вместо distAt
    if (!this.finished && t >= this.level.durationSec - 0.03) {
      this.finished = true;
      this.coastV = this.level.speedAt(this.level.durationSec - 0.2);
      // тормозим — задние фонари ярче
      const tail = this.car.getObjectByName('taillight') as THREE.Mesh | null;
      if (tail) (tail.material as THREE.MeshStandardMaterial).emissiveIntensity = 5;
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
      this.camera.position.set(cx + this.carX + shX * 0.5, y + 1.16 + shY * 0.5, -dist - 0.95);
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
      (b) => {
        if (b.kind === 'magnet') {
          this.magnetUntil = t + 8;
          this.score += 50;
          this.pop('🧲 МАГНИТ!', 'pop-combo pop-super');
          this.particles.burst(b.x, b.y, -b.dist, new THREE.Color('#ffd24d'), 30);
          this.shake = Math.min(0.5, this.shake + 0.2);
          return;
        }
        if (b.kind === 'gold') {
          // джекпот: куш растёт с комбо — поймать на высоком стрике вкуснее
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
        const hadMiss = this.missStreak > 0;
        this.missStreak = 0;
        this.combo++;
        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.collected++;
        const pts = Math.round(
          (10 + (b.vel / 127) * 10) * b.count *
          (1 + Math.min(this.combo, 50) * 0.06) * (1 + this.feverLevel),
        );
        this.score += pts;
        this.sfx.collect(this.combo, this.fever, b.count);
        this.scoreBump();
        const milestone = this.popFx();
        // искры — на каждый блок; вспышка и тряска — только на события,
        // иначе на длинной сессии глаз выгорает и события не читаются
        this.particles.burst(b.x, b.y, -b.dist, LANE_COLORS[b.lane + 1], 12 + b.count * 6);
        if (milestone) {
          this.flash(LANE_CSS[b.lane + 1]);
          this.shake = Math.min(0.45, this.shake + 0.3);
        } else if (b.count > 1) {
          this.shake = Math.min(0.45, this.shake + 0.04 * b.count);
        }
        if (hadMiss && Math.random() < 0.4) this.pop('ДАВАЙ ЕЩЁ!', 'pop-combo');
        this.syncFever();
      },
      () => {
        // прощающее комбо: одиночный промах — тишина
        this.missStreak++;
        if (this.missStreak >= this.missLimit && this.combo > 0) {
          this.missStreak = 0;
          this.breakCombo();
          this.sfx.miss();
        }
      },
    );

    // трафик: столкновение = откат комбо и штраф, но не смерть
    const hitObs = this.traffic.update(t, this.level, dist, cx + this.carX);
    if (hitObs && t > this.invulnUntil) {
      this.invulnUntil = t + 1.5;
      this.missStreak = 0;
      this.breakCombo();
      this.score = Math.max(0, this.score - 50);
      this.sfx.crash();
      this.pop('💥', 'pop-combo pop-crash');
      this.flash('#ff4433');
      this.shake = 0.8;
      this.hitStop = 0.09;
    }

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
