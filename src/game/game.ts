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
  Blocks, VOICE_COLORS, VOICE_CSS, POWER_COLOR, POWER_CSS,
  type Difficulty, type BlockExtras, type BlockDef,
} from './blocks';
import { makeGate } from './gate';
import { steerRange, trailWeave, trailWeaveSlope, crashBend } from './road';
import { Particles } from './particles';
import { Traffic } from './traffic';
import { Sfx } from './sfx';
import { IntensityDirector } from './intensity';
import { Story, type Phase, type StoryCam, WINTER, lerpTheme } from './story';
import { Narrator } from './narrator';
import { Runner } from './runner';
import { NightAmbient } from './ambient';
import { makeGlitchPass } from './glitchPass';
import type { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { Level } from './level';
import { EndlessChain } from './chain';
import type { Conductor } from '../conductor';
import type { Song } from 'midi-gen/core';


// константы кадра — выносим из tick, чтобы не аллоцировать каждый кадр/сбор
const MILESTONES = [0, 5, 10, 15, 20, 30, 50];
const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// цвета искр — переиспользуемые инстансы вместо new THREE.Color на каждое событие
const C_GOLD = new THREE.Color('#ffd24d');
const C_GOLD_SPARK = new THREE.Color('#fff3a0');
const C_WHITE = new THREE.Color('#ffffff');
const C_PERFECT = new THREE.Color('#ffe9a0');
const C_SHIELD = new THREE.Color('#44d6ff');

export class Game {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private camera: THREE.PerspectiveCamera;
  private world: World;
  private car: THREE.Group;
  private blocks!: Blocks; // одиночный трек; в endless блоки живут в chain
  private traffic!: Traffic;
  private chain: EndlessChain | null = null;
  private conductor: Conductor | null = null; // endless: для турбо-рампа темпа
  private endless = false;
  private posSource!: { positionSec(): number; isPlaying(): boolean };
  private invulnUntil = -1; // после удара — 1.5 с неуязвимости
  private particles = new Particles();
  private shake = 0;
  readonly sfx = new Sfx();
  private hud: HTMLDivElement;
  private fx: HTMLDivElement;
  private feverEdge: HTMLDivElement;
  private comboBar: HTMLDivElement;
  private comboBarFill: HTMLDivElement;
  // #20 комбо-кольцо + #19 овердрайв (Zone: банк энергии → разрядка)
  private comboRingWrap!: HTMLDivElement;
  private comboRing!: HTMLDivElement;
  private comboRingLabel!: HTMLDivElement;
  private odBar!: HTMLDivElement;
  private odFill!: HTMLDivElement;
  private odIcon!: HTMLDivElement;
  private odPrompt!: HTMLDivElement;
  private turboFx!: HTMLDivElement; // оверлей скоростных полос/размытия
  private feverEdgeCls = '';
  // турбо «закись азота»: бак копится сбором, тратится ПОКА ДЕРЖИШЬ кнопку
  private energy = 0; // 0..1 бак закиси
  private nosHeld = false; // кнопка турбо зажата
  private nosActive = false; // турбо реально работает (зажата + есть заряд)
  private nosVis = 0; // сглаженная визуальная интенсивность 0..1
  private get overdrive() { return this.nosActive; } // ×2 очки/магнит/края — пока активно
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
  // #25/#26 разогрев сессии: растёт за собранные блоки всю сессию (не рвётся
  // аварией), даёт растущий множитель и всё более богатую картинку — награда
  // за «играть часами безвылазно». Сброс только при выходе в меню (новый Game).
  private sessionHeat = 0;
  private perfectStreak = 0; // #27 PERFECT подряд → восходящее арпеджио + бонус
  private goldenUntil = -1; // #18 золотая волна активна до этого времени
  private nextGolden = -1; // когда стартует следующая золотая волна
  private nextNovelty = -1; // #36/#35 когда сменить тему/погоду (новизна против скуки)
  private lastComboTier = 1; // #11/#12 отслеживаем смену музыкального слоя по комбо
  private lastPattern: BlockDef['pattern'] = undefined; // анонс входа в паттерн
  // #23/#24 микро-цель: короткая задача (10–20с), цель мелкая → полоска почти
  // полна постоянно. Выполнил → бонус + новая. Близкий ясный таргет (СДВГ).
  private goalEl!: HTMLDivElement;
  private goal: { kind: 'combo' | 'perfect' | 'collect' | 'nocrash'; target: number; base: number; label: string } | null = null;
  // DDA-интенсивность: кольцо последних попаданий/промахов + комбо.
  // Двунаправленно: жжёшь — гуще блоки и трафик, мажешь — реже.
  private hitRing: number[] = [];
  private intensity = 0.6;
  private missStreak = 0;
  private missLimit: number;
  /** «Здоровье» лид-мелодии 0..1: промах включает спад (до нуля за ~1.3с), любой
   *  сбор мгновенно возвращает полную. Маппится в leadGuide кондуктора. */
  private leadHealth = 1;
  private leadFading = false; // идёт затухание (взведено промахом, снято сбором)
  private engaged = false; // игра «началась» — с первого собранного блока (до него мелодия полная)
  /** Fever-уровни: x15/x30/x50 комбо → множитель ×2/×3/×4. */
  private feverLevel = 0;
  private get fever() { return this.feverLevel > 0; }
  private magnetUntil = -1; // время музыки, до которого активен магнит
  private doubleUntil = -1; // время музыки, до которого активен ×2 за пикап
  private tripleUntil = -1; // ×3 «френзи»-пикап
  private ramUntil = -1; // «таран»: плуг сквозь преграды без штрафа (таймовый)
  private shielded = false; // щит: следующая авария без штрафа
  private hitStop = 0; // сек заморозки мира — продаёт вес удара
  private bloomPass: UnrealBloomPass | null = null;
  // #A дирижёр интенсивности: серый ночной базис ↔ редкие пики (см. intensity.ts)
  private director = new IntensityDirector();
  // сюжетный спуск (story.ts): живёт в бесконечном заезде, по дистанции уводит
  // мир в сюр. null в обычном (не-endless) заезде. narrator — суб-полоса реплик.
  private story: Story | null = null;
  private narrator: Narrator | null = null;
  private glitchPass: ShaderPass | null = null;
  // пеший режим: машина прячется, бежит/идёт человечек (runner.ts)
  private runner: Runner | null = null;
  private onFoot = false;
  private storyCam: StoryCam = 'chase'; // текущий режим камеры из Story
  // роща/озеро — Firewatch-управление: ходьба клавишами + свободный mouse-look
  private walkMode = false;      // дистанцию ведут шаги (W), не аудио
  private walkDist = 0;          // накопленная пешая дистанция
  private frozen = false;        // озеро: движение остановлено (сидишь)
  private runnerLift = 0;        // подъём человечка на камень в конце тропы (плавный)
  private playSec = 0;           // суммарное время игры (для титров «прошли за N минут»)
  private creditsShown = false;  // финальные титры уже запущены
  private replayPromptShown = false; // нарратор переключился с поздравления на выбор Y/N
  private lookYaw = 0;           // свободный осмотр: поворот (рад)
  private lookPitch = 0;         // свободный осмотр: наклон (рад)
  private keyFwd = false;
  private keyLeft = false; private keyRight = false;
  private crashUntil = -1;       // таймер краш-секвенса (машину переворачивает), сек
  private crashSide = 1;         // в какую сторону уносит машину при крахе
  private crashDist = 0;         // дистанция апекса поворота-аварии
  private crashArmed = false;    // резкий поворот перед аварией уже включён (виден на подъезде)
  private approachStarted = false; // подъезд к аварии: поле + зима наступают
  private approachFromTheme: WorldTheme | null = null; // тема, ИЗ которой к зиме
  private zonesSet = false;      // пешие зоны по дистанции включены (бесшовные переходы)
  private wrecked = false;       // машина лежит перевёрнутым обломком (виден, можно обойти)
  private readonly wreckPos = new THREE.Vector3(); // мировая позиция обломка
  private readonly activePos = new THREE.Vector3(); // за кем следует мир (машина/игрок)
  private wreckYaw = 0;          // рыскание обломка
  private orbitR = 5.5;          // радиус орбитальной камеры (3-е лицо вокруг человечка)
  private fpDebug = false;       // C: переключить вид на первое лицо (для теста)
  private ambient: NightAmbient | null = null; // ночной амбиент (роща/озеро)
  private sitTime = 0;           // секунды на берегу (freeze) — гонит реплики по времени
  private bpm: number;
  private bestScore: number; // глобальный рекорд — призрак-цель в HUD
  private recordBroken = false;
  private themeIndex = 0; // клавиша 0 перебирает темы оформления на лету
  private tailMat: THREE.MeshStandardMaterial | null = null;
  private tailBase = 0.6; // сглаженный накал линзы (мерцание накладывается поверх)
  private tailGlows: THREE.Sprite[] = []; // ореолы свечения фар
  private fpsEMA = 60; // сглаженный FPS для дебаг-лога (НЕ УДАЛЯТЬ — нужен до релиза)
  private logAcc = 0; // аккумулятор для лога раз в секунду
  private hudAcc = 0; // аккумулятор обновления HUD (~15 Гц вместо каждого кадра)
  private lastHud = ''; // прошлый текст HUD — пропускаем одинаковые DOM-записи
  // авто-деградация качества: включается ТОЛЬКО когда FPS устойчиво просел
  private baseRatio = Math.min(devicePixelRatio, 1.5);
  private qualityLow = false;
  private lowFpsAcc = 0;
  private highFpsAcc = 0;
  private prevSpeed = 0; // для определения торможения (яркость задней фары)
  // финиш: камера остаётся у ворот, машина катится по инерции и плавно тормозит
  private finished = false;
  private coastV = 0;
  private coastDist = 0;
  private finishNotified = false;
  onFinish?: () => void;
  /** Финал: Y — сыграть ещё раз (с сюжетом), N — обычная безлимитная гонка. */
  onReplay?: (withStory: boolean) => void;
  /** endless: вызывается на финише трека (для тикера/наград). */
  onSegment?: () => void;
  private lastSeamT = 0; // транспортное время последнего отпразднованного стыка
  private finaleCamT = -1; // старт камео-флориша на финише трека
  private finaleEnv = 0; // 0..1 огибающая финал-климакса (салют/блум/края)
  get blocksTotal() { return this.endless ? 0 : this.blocks.total; }
  private mouseX = 0; // -1..1
  private carX = 0;
  private firstPerson = false;
  paused = false;
  private tEst = 0; // сглаженные часы музыки
  private errSmooth = 0; // сглаженная ошибка рассинхрона — гасит дрожь outputLatency, не теряя точность
  private audioStarted = false; // звук реально зазвучал — машина трогается только тогда
  private vxSmooth = 0; // сглаженная боковая скорость — крен без высокочастотной тряски
  private camScratch = new THREE.Vector3(); // переиспользуемый вектор камеры — без аллокаций в кадре
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  constructor(
    container: HTMLElement,
    song: Song,
    private level: Level,
    private player: Player | null,
    diff: Difficulty = 'norm',
    private audioOffset = 0, // сек; калибровка из меню
    extras: BlockExtras & {
      lucky?: boolean; best?: number; carColor?: number; theme?: WorldTheme;
    } = { gold: false, mystery: 0 },
    endlessOpts?: { conductor: Conductor; nextSong: () => Promise<Song>; story?: boolean },
  ) {
    this.missLimit = diff === 'hard' ? 2 : 3;
    this.bpm = song.bpm;
    this.applySfxGenre(song.genre); // тембр сбора под жанр стартового трека
    this.sfx.setKey(song.key.tonic, song.key.mode); // строй сбора = тональность трека
    this.bestScore = extras.best ?? 0;
    this.endless = !!endlessOpts;
    this.car = buildCar({ color: extras.carColor ?? 0x6b1220 });
    // замыкания мира читают this.level — в endless ниже он становится цепочкой
    this.world = new World(
      (z) => this.level.heightAt(-z), (z) => this.level.curveAt(-z),
      (z) => this.level.wideAt(-z), (z) => this.level.districtAt(-z), extras.theme,
    );
    if (extras.theme) this.themeIndex = Math.max(0, THEMES.indexOf(extras.theme));
    // кеш материала задней фары (обе фары делят один материал) и glow-ореолов
    const tailMesh = this.car.getObjectByName('taillight') as THREE.Mesh | null;
    // линза-эмиссив = задняя грань (+z, индекс 4); материал мог стать массивом
    const tailM = tailMesh?.material;
    this.tailMat = (Array.isArray(tailM) ? tailM[4] : tailM) as THREE.MeshStandardMaterial ?? null;
    this.car.traverse((o) => {
      if (o.name === 'tailglow' && o instanceof THREE.Sprite) this.tailGlows.push(o);
    });
    this.world.scene.add(this.particles.points);

    if (endlessOpts) {
      // бесконечный сет: цепочка сегментов владеет блоками/трафиком и аудио;
      // scene уже создана миром → можно подвесить первый сегмент сразу
      this.posSource = endlessOpts.conductor;
      this.conductor = endlessOpts.conductor;
      this.chain = new EndlessChain(
        this.world.scene, endlessOpts.conductor, diff, endlessOpts.nextSong,
      );
      this.chain.pushFirst(song);
      this.level = this.chain; // дальше вся геометрия/тайминги — из цепочки
      this.world.rebuild(); // чанки были построены со заглушкой — пересобрать под цепочку
      // сюжетный спуск активен только в бесконечном заезде И если не отключён
      // (N в финале → обычная безлимитная гонка без аварии/сюжета)
      if (endlessOpts.story !== false) {
        this.story = new Story();
        const jump = new URLSearchParams(location.search).get('story'); // dev: ?story=forest
        if (jump) this.story.jumpTo(jump as Phase);
      }
    } else {
      this.posSource = this.player!;
      this.blocks = new Blocks(song, this.level, diff, extras);
      this.traffic = new Traffic(this.level, this.blocks, diff);
      this.world.scene.add(this.blocks.mesh, this.blocks.gates, this.traffic.root);
      // ворота старта и финиша поперёк дороги
      for (const [label, color, css, d] of [
        ['СТАРТ', 0x22ffee, '#22ffee', this.level.distAt(1.2)],
        ['ФИНИШ', 0xff44ff, '#ff44ff', this.level.distAt(this.level.durationSec - 0.4)],
      ] as const) {
        const gate = makeGate(label, color, css);
        const dir = (this.level.curveAt(d + 2) - this.level.curveAt(d - 2)) / 4;
        gate.position.set(this.level.curveAt(d), this.level.heightAt(d), -d);
        gate.rotation.y = -Math.atan(dir);
        this.world.scene.add(gate);
      }
    }
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
      // глитч-слой «сходит с ума» — гонится insanity (story.ts), ноль на старте
      this.glitchPass = makeGlitchPass();
      this.composer.addPass(this.glitchPass);
      this.composer.addPass(new OutputPass());
      // bloom в half-res: визуально почти идентично (bloom — и так размытие),
      // но вчетверо меньше пикселей под тяжёлый пасс → запас GPU под звук.
      // addPass уже выставил полный размер — переустанавливаем на половину
      this.applyBloomRes();
    }

    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    container.appendChild(this.hud);
    this.fx = document.createElement('div');
    this.fx.className = 'fx-layer';
    container.appendChild(this.fx);
    this.narrator = new Narrator(container); // суб-полоса реплик спуска
    this.feverEdge = document.createElement('div');
    this.feverEdge.className = 'fever-edge';
    container.appendChild(this.feverEdge);
    this.comboBar = document.createElement('div');
    this.comboBar.className = 'combo-bar';
    this.comboBarFill = document.createElement('div');
    this.comboBar.appendChild(this.comboBarFill);
    container.appendChild(this.comboBar);
    // комбо-кольцо у машины + банк овердрайва под ним
    this.comboRingWrap = document.createElement('div');
    this.comboRingWrap.className = 'combo-ring-wrap';
    this.comboRing = document.createElement('div');
    this.comboRing.className = 'combo-ring';
    this.comboRingLabel = document.createElement('div');
    this.comboRingLabel.className = 'combo-ring-label';
    this.comboRingWrap.append(this.comboRing, this.comboRingLabel);
    container.appendChild(this.comboRingWrap);
    this.odBar = document.createElement('div');
    this.odBar.className = 'od-bar';
    this.odFill = document.createElement('div');
    this.odBar.appendChild(this.odFill);
    container.appendChild(this.odBar);
    this.odIcon = document.createElement('div');
    this.odIcon.className = 'od-icon';
    this.odIcon.textContent = '⚡ УСКОРЕНИЕ';
    container.appendChild(this.odIcon);
    this.odPrompt = document.createElement('div');
    this.odPrompt.className = 'od-prompt';
    container.appendChild(this.odPrompt);
    // оверлей скоростных полос/размытия — включается на турбо
    this.turboFx = document.createElement('div');
    this.turboFx.className = 'turbo-fx';
    container.appendChild(this.turboFx);
    this.goalEl = document.createElement('div');
    this.goalEl.style.cssText = 'position:absolute;top:3.2rem;left:1.2rem;z-index:5;'
      + 'pointer-events:none;color:#8fe;font:700 13px/1 system-ui,sans-serif;'
      + 'text-shadow:0 1px 3px #000;opacity:.85';
    container.appendChild(this.goalEl);
    this.pickGoal();

    this.world.scene.add(this.car);

    addEventListener('mousemove', this.onMouse);
    addEventListener('resize', this.onResize);
    addEventListener('keydown', this.onKey);
    document.addEventListener('pointerlockchange', this.onLockChange);
    this.renderer.domElement.addEventListener('click', this.grabPointer);
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    addEventListener('mouseup', this.onMouseUp);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
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

  // турбо «закись азота» — HOLD: зажал → тратится и ускоряет, отпустил → стоп
  private onMouseDown = (e: MouseEvent) => { if (e.button === 0 && !this.walkMode) this.nosHeld = true; }; // пешком клик не даёт турбо
  private onMouseUp = () => { this.nosHeld = false; };
  // ходьба: и латиница (e.code — физическая клавиша), и кириллица (e.key) — если
  // игрок не переключил раскладку, WASD = ЦФЫВ на тех же клавишах
  private static isFwd = (e: KeyboardEvent) => e.code === 'KeyW' || e.code === 'ArrowUp' || e.key === 'ц' || e.key === 'Ц';
  private static isLeft = (e: KeyboardEvent) => e.code === 'KeyA' || e.code === 'ArrowLeft' || e.key === 'ф' || e.key === 'Ф';
  private static isRight = (e: KeyboardEvent) => e.code === 'KeyD' || e.code === 'ArrowRight' || e.key === 'в' || e.key === 'В';

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') this.nosHeld = false;
    if (Game.isFwd(e)) this.keyFwd = false;
    if (Game.isLeft(e)) this.keyLeft = false;
    if (Game.isRight(e)) this.keyRight = false;
  };

  // потеря фокуса (alt-tab, СМЕНА РАСКЛАДКИ) может «съесть» keyup → клавиша
  // залипает. Сбрасываем движение, чтобы ходьба не зависала/не ехала сама.
  private onBlur = () => { this.keyFwd = this.keyLeft = this.keyRight = false; this.nosHeld = false; };

  private onKey = (e: KeyboardEvent) => {
    // ФИНАЛ (титры на берегу): Y — сыграть ещё раз (с сюжетом), N — обычная гонка
    if (this.replayPromptShown && this.frozen) {
      // Y/N — и латиница, и кириллица (Y=н, N=т на ЙЦУКЕН)
      if (e.code === 'KeyY' || e.key === 'н' || e.key === 'Н') { this.onReplay?.(true); return; }
      if (e.code === 'KeyN' || e.key === 'т' || e.key === 'Т') { this.onReplay?.(false); return; }
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') this.nosHeld = true;
    // WASD/стрелки (и кириллица ЦФЫВ) — ходьба в пешем режиме; в гонке не влияют
    if (Game.isFwd(e)) this.keyFwd = true;
    if (Game.isLeft(e)) this.keyLeft = true;
    if (Game.isRight(e)) this.keyRight = true;
    // C — переключить вид: в гонке салон/снаружи, пешком — 3-е лицо/1-е лицо (тест)
    if (e.code === 'KeyC') {
      if (this.walkMode) this.fpDebug = !this.fpDebug;
      else this.firstPerson = !this.firstPerson;
    }
    // dev (Z): встать за ~10с до поворота-аварии — быстро тестить лес/краш
    if (e.code === 'KeyZ' && this.story) {
      this.story.approachForest(400);
      this.pop('⏩ к повороту в лес', 'pop-theme');
    }
    if (e.code === 'Digit0' || e.code === 'Numpad0') {
      // перебор тем оформления на лету — посмотреть снег/дождь/рассвет/закат
      this.themeIndex = (this.themeIndex + 1) % THEMES.length;
      const th = THEMES[this.themeIndex];
      this.world.applyTheme(th);
      this.pop(`🎨 ${th.name}`, 'pop-theme');
    }
    // dev: Shift+1..4 — прыжок к фазе (1 гонка, 2 лес, 3 роща, 4 озеро)
    if (e.shiftKey && this.story && e.code.startsWith('Digit')) {
      const n = +e.code.slice(5);
      if (n >= 1 && n <= 4) {
        this.story.jumpTo(n);
        this.narrator?.clear();
        // прыжок меняет bias → пересинхронизируем границы зон в world (иначе пешие
        // зоны/озеро уезжают). И подхватываем дистанцию под новую фазу.
        if (this.zonesSet) {
          const [zf, zg, zl] = this.story.zoneStarts();
          this.world.setZones(zf, zg, zl);
          const target = [undefined, undefined, zf, zg, zl][n]; // 2 лес,3 роща,4 озеро
          if (target != null) this.walkDist = target + 5; // встать на старт фазы
          this.frozen = false; this.sitTime = 0;
        }
      }
    }
  };

  /**
   * Кинематографичная авария: на непроходимом повороте машину сносит ПРЯМО (в лес),
   * пока дорога с кристаллами уходит в поворот, и переворачивает колёсами кверху.
   * Ставит и машину (кувырок), и камеру 3-го лица (провожает кувырок). cx,y — точка съезда.
   */
  private updateCrash(t: number, cx: number, y: number, dt: number) {
    const dur = 3.6;
    const p = THREE.MathUtils.clamp(1 - (this.crashUntil - t) / dur, 0, 1); // 0..1
    const ease = (x: number) => 1 - (1 - x) * (1 - x); // easeOutQuad
    const launchX = cx + this.carX;
    const fwd = ease(p) * 26;                        // едем ПРЯМО (дорога ушла в поворот — мы нет)
    const sideX = -this.crashSide * ease(p) * 13;    // сносит НА ВНЕШНЮЮ сторону поворота, в деревья
    const arc = Math.sin(p * Math.PI) * 2.6                       // подброс
      + Math.max(0, Math.sin(p * 13)) * (1 - p) * 0.8;           // отскоки
    this.car.visible = true;
    this.car.position.set(launchX + sideX, y + arc, -this.crashDist - fwd);
    // переворот: к концу — колёсами кверху (≈0.94π) с затухающим вихлянием
    const rx = THREE.MathUtils.lerp(0, Math.PI * 0.94, ease(p)) + Math.sin(p * 20) * (1 - p) * 1.1;
    const rz = this.crashSide * (Math.sin(p * 15) * (1 - p) * 1.4 + 0.16 * ease(p));
    this.car.rotation.set(rx, this.car.rotation.y, rz);
    // камера ПЛАВНО провожает машину (сзади-сверху, чуть сбоку), а не «прыгает» на
    // фикс-точку — продолжение погони, без резкой смены кадра. Дрожь от удара.
    const shake = (1 - p) * 0.5;
    const target = this.camScratch.set(
      this.car.position.x + this.crashSide * 2,
      this.car.position.y + 4.2,
      this.car.position.z + 10.5,
    );
    this.camera.position.lerp(target, 1 - Math.exp(-6 * dt));
    this.camera.position.x += (Math.random() - 0.5) * shake;
    this.camera.position.y += (Math.random() - 0.5) * shake;
    this.camera.lookAt(this.car.position.x, this.car.position.y + 0.4, this.car.position.z);
    this.camera.rotation.z += Math.sin(t * 26) * 0.1 * (1 - p);
  }

  /** Высота земли. В зоне ОЗЕРА выравниваем к плоской глади (как world.hAt) —
   *  человечек/камера/вода на одном плоском уровне, озеро читается. */
  private groundY(dist: number): number {
    if (!this.zonesSet || !this.story) return this.level.heightAt(dist);
    const ls = this.story.zoneStarts()[2];
    if (dist < ls - 45) return this.level.heightAt(dist);
    const k = THREE.MathUtils.clamp((dist - (ls - 45)) / 45, 0, 1);
    let h = this.level.heightAt(dist) * (1 - k) + this.level.heightAt(ls) * k;
    const lakeEnd = ls + 70; // конец тропы (story.freezeAfter) — дальше полотно под воду
    if (dist > lakeEnd) h -= Math.min(1, (dist - lakeEnd) / 7) * 3.4;
    return h;
  }

  /** Убрать весь гоночный HUD после аварии (пешая фаза = «другая игра»): очки/
   *  скорость/цель, комбо-кольцо и шкала, овердрайв-ускорение, fever-края, турбо.
   *  Нарратор и слой вспышек (this.fx) остаются. */
  private hideRaceHud() {
    for (const el of [
      this.hud, this.feverEdge, this.comboBar, this.comboRingWrap,
      this.odBar, this.odIcon, this.odPrompt, this.turboFx, this.goalEl,
    ]) { if (el) el.style.display = 'none'; }
  }

  private walkHint: HTMLDivElement | null = null;
  /** Аккуратная подсказка слева-сверху после аварии: чем двигаться. Сама гаснет. */
  private showWalkHint() {
    if (this.walkHint) return;
    const el = document.createElement('div');
    el.textContent = 'Движение — WASD или стрелки';
    el.style.cssText = 'position:absolute;top:14px;left:16px;z-index:8;pointer-events:none;'
      + 'padding:.45rem .7rem;border-radius:10px;background:rgba(12,16,22,.5);'
      + 'color:#dfe6f2;font:600 14px/1 system-ui,sans-serif;text-shadow:0 1px 3px #000;'
      + 'backdrop-filter:blur(4px);transition:opacity 1.2s;opacity:0';
    this.fx.appendChild(el);
    this.walkHint = el;
    requestAnimationFrame(() => { if (this.walkHint) this.walkHint.style.opacity = '1'; });
    // научили — через ~12 c мягко убираем, чтобы не мешать созерцанию
    setTimeout(() => { if (this.walkHint) this.walkHint.style.opacity = '0'; }, 12000);
  }

  /** #14 тактильная отдача (мобайл/поддерживающие устройства) — no-op иначе. */
  private haptic(ms: number | number[]) {
    try { (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(ms); }
    catch { /* не поддержано */ }
  }

  private sfxGenre = ''; // последний жанр, отданный в Sfx (анти-дубль)
  private sfxTonic = -1; private sfxMode = ''; // последний строй, отданный в Sfx
  /** Сменить тембр сбора под жанр, если он из поддерживаемой тройки. */
  private applySfxGenre(g: string) {
    if (g === this.sfxGenre) return;
    if (g === 'grimerun' || g === 'outrun' || g === 'eurobeat'
        || g === 'doomerrun' || g === 'nightcorerun') {
      this.sfxGenre = g;
      this.sfx.setGenre(g);
    }
  }

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
    // перезапуск CSS-анимации без forced reflow (void offsetWidth дёргал layout
    // на каждый собранный блок): снимаем класс и возвращаем на следующем кадре
    this.hud.classList.remove('bump');
    requestAnimationFrame(() => { if (!this.disposed) this.hud.classList.add('bump'); });
  }

  /**
   * Срыв: падение на предыдущую веху (x30 → x20), не в ноль — качели
   * полный сброс комбо в ноль (кольцо обнуляется, fever гаснет). Одиночный
   * промах прощается (см. missLimit) — сбрасывает только лимит промахов или
   * авария, чтобы у множителя были реальные ставки.
   */
  private breakCombo() {
    this.combo = 0;
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
    // края экрана (fever/overdrive/пре-fever) обновляются централизованно в HUD-тике
    // музыкальные слои: в endless тир ведётся в tick (интро не молчит); для
    // одиночного трека — по комбо: база / +chords·counter (x8) / всё (x16)
    if (!this.endless) {
      const tier = this.combo >= 16 ? 2 : this.combo >= 8 ? 1 : 0;
      (this.player as Player & { setTier?: (t: number) => void }).setTier?.(tier);
    }
  }

  /**
   * Сбор блока: очки/эффекты. distOffset — глобальный сдвиг сегмента (endless),
   * чтобы искры/вспышки легли в мировой z. Для одиночного трека distOffset=0.
   */
  private onCollect(b: BlockDef, perfect: boolean, t: number, distOffset: number) {
    const wz = -(b.dist + distOffset); // мировой z блока
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
      } else if (power === 'triple') {
        this.tripleUntil = t + 8;
        this.pop('✖3 ФРЕНЗИ!', 'pop-combo pop-mega');
      } else if (power === 'ram') {
        this.ramUntil = t + 5;
        this.pop('🚂 ТАРАН!', 'pop-combo pop-mega');
      } else {
        this.magnetUntil = t + 8;
        this.pop('🧲 МАГНИТ!', 'pop-combo pop-super');
      }
      this.particles.burst(b.x, b.y, wz, POWER_COLOR[power], 30);
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
      this.particles.burst(b.x, b.y, wz, C_GOLD_SPARK, 60);
      this.shake = Math.min(0.6, this.shake + 0.5);
      this.hitStop = 0.07;
      this.sfx.jackpot();
      if (!this.overdrive) this.energy = Math.min(1.2, this.energy + 0.06);
      this.scoreBump();
      return;
    }
    if (b.kind === 'mystery') {
      // содержимое неизвестно до подбора — variable-ratio в чистом виде
      this.mysteryGot++;
      const r = Math.random();
      if (r < 0.02) {
        // #21 ЛЕГЕНДА (~2%): огромный куш + салют + зажигает золотую волну
        const pts = Math.round(700 * (1 + this.feverLevel));
        this.score += pts;
        this.goldenUntil = Math.max(this.goldenUntil, t + 4);
        this.pop(`🌈 ЛЕГЕНДА! +${pts}`, 'pop-combo pop-mega');
        this.celebrate();
        this.particles.burst(b.x, b.y, wz, C_GOLD_SPARK, 60);
        this.scoreBump();
        return;
      }
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
      this.particles.burst(b.x, b.y, wz, C_WHITE, 50);
      this.shake = Math.min(0.5, this.shake + 0.3);
      this.sfx.mystery();
      if (!this.overdrive) this.energy = Math.min(1.2, this.energy + 0.05);
      this.scoreBump();
      return;
    }
    this.missStreak = 0;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.collected++;
    this.trackHit(true);
    this.leadHealth = 1; this.leadFading = false; // ЛЮБОЙ сбор мгновенно возвращает мелодию
    this.engaged = true; // первый сбор = «игра началась» (до него мелодия не трогается)
    // кульминация дропа — отдельный анонс + событийный всплеск (пик музыки = пик игры)
    if (b.drop) {
      this.pop('🔥 ДРОП!', 'pop-combo pop-mega');
      this.director.spark(0.6);
    } else if (b.pattern && b.pattern !== this.lastPattern) {
      // анонс входа в хореографированный паттерн — чтобы фигура читалась явно
      const PAT_LABEL: Record<NonNullable<BlockDef['pattern']>, string> = {
        sweep: '🌊 ВОЛНА!', wall: '🧱 СТЕНА!', zigzag: '⚡ ЗИГЗАГ!',
        stairs: '🪜 ЗАБЕГ!', pendulum: '🌀 РАЗГОН!', double: '👯 ДАБЛ!',
      };
      this.pop(PAT_LABEL[b.pattern], 'pop-combo pop-super');
    }
    this.lastPattern = b.pattern;
    // разогрев сессии: каждые 70 блоков — тир вверх (растущий множитель/спектакль)
    const newHeat = Math.floor(this.collected / 70);
    if (newHeat > this.sessionHeat) { this.sessionHeat = newHeat; this.heatUp(); }
    // grading + #27 PERFECT-стрик: серия центровых попаданий растит бонус и питч
    if (perfect) {
      this.perfects++;
      this.perfectStreak++;
      if (this.perfectStreak % 5 === 0) this.pop(`✨ PERFECT ×${this.perfectStreak}`, 'pop-perfect pop-mega');
    } else {
      this.perfectStreak = 0;
    }
    const grade = perfect ? 1.2 + Math.min(this.perfectStreak, 10) * 0.03 : 1;
    const dbl = t < this.tripleUntil ? 3 : t < this.doubleUntil ? 2 : 1; // пикап ×2/×3
    const od = this.overdrive ? 2 : 1; // овердрайв ×2 поверх всего
    const heat = 1 + Math.min(this.sessionHeat, 30) * 0.05; // разогрев: до +1.5× за долгую сессию
    const golden = t < this.goldenUntil; // #18 золотая волна
    const gw = golden ? 2.5 : 1;
    const wide = b.wide ? 2 : 1; // МЕГА-блок ×2
    const pts = Math.round(
      (10 + (b.vel / 127) * 10) * b.count *
      (1 + Math.min(this.combo, 50) * 0.06) * (1 + this.feverLevel) * grade * dbl * od * heat * gw * wide,
    );
    this.score += pts;
    // банк овердрайва копится сбором (не во время самого овердрайва)
    if (!this.overdrive) this.energy = Math.min(1.2, this.energy + (perfect ? 0.02 : 0.012));
    this.sfx.collect(this.combo, this.fever, b.count, b.beatType, b.voice, b.pitch, perfect);
    this.scoreBump();
    const milestone = this.popFx();
    // искры — на каждый блок; PERFECT добавляет золотую вспышку искр
    // #40 directional: обломки летят НА камеру (vzBias +6) — «снёс блок собой»
    // #A плотность искр масштабируем arousal'ом — спектакль как акцент, не фон
    this.particles.burst(b.x, b.y, wz, golden ? C_GOLD_SPARK : VOICE_COLORS[b.voice],
      (12 + b.count * 6) * (b.wide ? 2 : 1) * this.director.sparkScale(), 6);
    if (golden) this.director.spark(0.5); // золотой блок — событийный всплеск
    if (b.wide) this.shake = Math.min(0.5, this.shake + 0.12); // МЕГА — ощутимый удар
    if (perfect) {
      this.particles.burst(b.x, b.y + 0.3, wz, C_PERFECT, 8);
      if (!milestone && this.combo % 3 === 0) this.pop('PERFECT', 'pop-perfect');
    }
    if (milestone) {
      this.flash(VOICE_CSS[b.voice]);
      this.shake = Math.min(0.45, this.shake + 0.3);
      this.director.spark(0.3); // веха комбо — заметный всплеск
      this.haptic(12);
    } else if (b.count > 1) {
      this.shake = Math.min(0.45, this.shake + 0.04 * b.count);
    }
    this.syncFever();
  }

  /** Выбрать новую микро-цель (мелкий близкий таргет). */
  private pickGoal() {
    const r = Math.floor(Math.random() * 4);
    if (r === 0) this.goal = { kind: 'collect', target: 12, base: this.collected, label: 'собери 12 блоков' };
    else if (r === 1) {
      const tgt = Math.max(10, Math.floor(this.combo / 5) * 5 + 10);
      this.goal = { kind: 'combo', target: tgt, base: 0, label: `комбо ×${tgt}` };
    } else if (r === 2) this.goal = { kind: 'perfect', target: 4, base: 0, label: '4 PERFECT подряд' };
    else this.goal = { kind: 'nocrash', target: 12, base: 0, label: '12с без аварии' };
  }

  /** Микро-цель выполнена: бонус + новая. */
  private completeGoal() {
    this.score += 100;
    this.bonusNotes += 3;
    this.pop('✅ ЦЕЛЬ! +100', 'pop-combo pop-super');
    this.flash('#66ff99');
    this.pickGoal();
  }

  /** Разогрев сессии вырос на тир: ярлык + золотая вспышка. */
  private heatUp() {
    this.pop(`🔥 РАЗОГРЕВ ×${(1 + Math.min(this.sessionHeat, 30) * 0.05).toFixed(2)}`, 'pop-combo pop-mega');
    this.flash('#ff8a3c');
    this.shake = Math.max(this.shake, 0.4);
    this.director.spark(0.5); // тир разогрева — крупный всплеск
  }

  /** Промах нот-блока: прощающее комбо — одиночный промах тихий. */
  private onMiss() {
    this.perfectStreak = 0; // серия центровых обрывается промахом
    this.trackHit(false);
    this.leadFading = true; // первый пропуск запускает спад мелодии (до нуля за ~1.3с)
    this.missStreak++;
    if (this.missStreak >= this.missLimit && this.combo > 0) {
      this.missStreak = 0;
      this.breakCombo();
      this.sfx.miss();
    }
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
    // финальная эскалация: последние 20% трека тянем к максимуму (кульминация).
    // в endless — прогресс внутри ТЕКУЩЕГО трека (каждый кончается пиком).
    const frac = this.endless && this.chain ? this.chain.localFrac(t) : t / this.level.durationSec;
    if (frac > 0.8) target = Math.max(target, 0.8 + (frac - 0.8) / 0.2 * 0.2);
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.8); // плавно ~1.3с
    // блоки-ноты НЕ прорежаем (раньше схлопывались в невидимость впереди —
    // выглядело странно/демотивирующе; промах и так прощается, хотим МНОГО
    // собирать). DDA рулит только плотностью ТРАФИКА (преград).
    if (this.endless && this.chain) this.chain.setIntensity(this.intensity);
    else this.traffic.setIntensity(this.intensity);
  }

  /** Церемония рекорда на финише: золотой салют вокруг машины. */
  celebrate() {
    const { x, y, z } = this.car.position;
    for (let k = 0; k < 3; k++)
      setTimeout(() => {
        if (this.disposed) return;
        this.particles.burst(x + (Math.random() - 0.5) * 4, y + 1.5, z - 2 - k * 2, C_GOLD, 50);
        this.shake = Math.min(0.5, this.shake + 0.25);
      }, k * 220);
    this.flash('#ffd24d');
    this.sfx.jackpot();
  }

  // финал-стык: 'soft' (по умолчанию — аккуратный фейерверк + надпись, без отрыва
  // камеры/вспышек/слоумо, не выбивает из потока) или 'strong' (старый климакс,
  // оставлен в «библиотеке»). Переключатель — `setFinaleMode`.
  private finaleMode: 'soft' | 'strong' = 'soft';
  /** Сменить стиль стыка треков ('soft' дефолт / 'strong' — старый климакс). */
  setFinaleMode(m: 'soft' | 'strong') { this.finaleMode = m; }

  /** Диспетчер стыка трека: мягкий (дефолт) или сильный (старый). */
  private finale(t: number) {
    if (this.finaleMode === 'strong') this.finaleStrong(t);
    else this.finaleSoft(t);
  }

  /**
   * МЯГКИЙ стык трека (дефолт): аккуратный фейерверк в небе + ненавязчивая надпись
   * (тот же текст: уровень пройден + следующий трек), БЕЗ отрыва камеры, БЕЗ
   * сильных вспышек/слоумо/тряски — поток не рвётся. Машина едет дальше.
   */
  private finaleSoft(t: number) {
    const t0 = performance.now(); // PERF-МЕТРИКА — НЕ УДАЛЯТЬ
    this.sfx.jackpot(); // лёгкий праздничный аккорд (без саб-бума)
    const genre = this.chain?.genreAt(t) ?? '';
    const title = this.chain?.titleAt(t) ?? '';
    // аккуратная надпись сверху — НЕ загораживает экран (без вуали/вспышки)
    const cap = document.createElement('div');
    cap.className = 'finale-soft';
    cap.innerHTML = '<div class="t">УРОВЕНЬ ПРОЙДЕН</div>'
      + `<div class="s">ДАЛЬШЕ${genre ? ': ' + genre.toUpperCase() : ''}${title ? ': «' + title + '»' : ''}</div>`;
    this.fx.appendChild(cap);
    setTimeout(() => cap.remove(), 2900);
    // фейерверк: несколько мягких залпов в небо за машиной (без тряски экрана)
    const { x, y, z } = this.car.position;
    for (let k = 0; k < 6; k++) {
      setTimeout(() => {
        if (this.disposed || this.paused) return;
        this.particles.burst(
          x + (Math.random() - 0.5) * 12, y + 2.5 + Math.random() * 4.5, z - 4 - Math.random() * 9,
          k % 2 ? C_GOLD : C_GOLD_SPARK, 34, 2,
        );
      }, k * 200);
    }
    this.onSegment?.(); // тикер + ноты/XP за пройденный трек
    console.warn(`[finale-soft] total ${(performance.now() - t0).toFixed(1)}ms @t=${t.toFixed(1)}`);
  }

  /**
   * СИЛЬНЫЙ финиш (старый, «библиотека» — по умолчанию НЕ используется): салют,
   * камео-флориш камеры (отъезд назад-вверх), полноэкранная вспышка/вуаль, слоумо.
   * Включается `setFinaleMode('strong')`.
   */
  private finaleStrong(t: number) {
    const t0 = performance.now(); // PERF-МЕТРИКА — НЕ УДАЛЯТЬ
    // #45 КЛИМАКС: ощутимый слоумо-фриз «прожить пик» + залпы салюта в небо
    // волнами 1.8с + золотая вспышка краёв всего экрана + всплеск блума.
    this.finaleCamT = t;
    this.shake = 0.95;
    this.flash('#ffd24d');
    this.sfx.jackpot();
    this.sfx.boom(); // саб-бум — ощутимый «бах»
    this.haptic([50, 70, 110]);
    // BULLET-TIME: мир (музыка+блоки+машина) резко проваливается в слоумо и
    // через ~0.5с выстреливает обратно в норму — главный источник масштаба.
    // (если игрок держит турбо — не трогаем его темп)
    if (!this.nosActive) {
      this.conductor?.setRate(0.4, 0.12);
      setTimeout(() => {
        if (!this.disposed && !this.nosActive) this.conductor?.setRate(1, 0.9);
      }, 480);
    }
    // климакс-ПЕРЕХОД (не «финиш» — едем дальше!): полноэкранная вспышка +
    // тройная ударная волна + хайп-слэм + подпись со след. треком
    const genre = this.chain?.genreAt(t) ?? '';
    const title = this.chain?.titleAt(t) ?? '';
    const fx = document.createElement('div');
    fx.className = 'finale-fx';
    fx.innerHTML = '<div class="finale-veil"></div><div class="finale-flash"></div>'
      + '<div class="finale-ring" style="--d:0s"></div>'
      + '<div class="finale-ring" style="--d:.13s"></div>'
      + '<div class="finale-ring" style="--d:.26s"></div>'
      + '<div class="finale-text">УРОВЕНЬ ПРОЙДЕН</div>'
      + `<div class="finale-sub">ДАЛЬШЕ${genre ? ': ' + genre.toUpperCase() : ''}${title ? ': «' + title + '»' : ''}</div>`;
    this.fx.appendChild(fx);
    setTimeout(() => fx.remove(), 1700);
    const { x, y, z } = this.car.position;
    // 10 залпов в небо/вокруг, с разлётом — масштабный фейерверк
    for (let k = 0; k < 10; k++) {
      setTimeout(() => {
        if (this.disposed || this.paused) return;
        this.particles.burst(
          x + (Math.random() - 0.5) * 14, y + 1 + Math.random() * 4, z - 1 - Math.random() * 9,
          k % 2 ? C_GOLD : C_GOLD_SPARK, 56, 2,
        );
        this.shake = Math.min(0.9, this.shake + 0.12);
      }, k * 170);
    }
    this.onSegment?.(); // тикер + ноты/XP за пройденный трек
    console.warn(`[finale] total ${(performance.now() - t0).toFixed(1)}ms @t=${t.toFixed(1)}`);
  }

  private onMouse = (e: MouseEvent) => {
    if (this.walkMode) {
      // пеший режим: мышь ВРАЩАЕТ камеру вокруг человечка (орбита), не руль.
      // Под pointer-lock — по дельте; без него — по позиции курсора.
      if (this.pointerLocked) {
        this.lookYaw -= e.movementX / 320;
        this.lookPitch += e.movementY / 320;
      } else {
        this.lookYaw = -((e.clientX / innerWidth) * 2 - 1) * Math.PI;
        this.lookPitch = ((e.clientY / innerHeight) * 2 - 1) * 0.8;
      }
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -1.2, 1.2);
      return;
    }
    if (this.pointerLocked) {
      // относительное движение, края «прилипают» — курсор не улетает
      this.mouseX = THREE.MathUtils.clamp(this.mouseX + e.movementX / 380, -1, 1);
    } else {
      this.mouseX = (e.clientX / innerWidth) * 2 - 1;
    }
  };

  /**
   * Самолечение от просадок: снижаем pixelRatio, когда железо устойчиво не
   * тянет, и возвращаем, когда отпустит. На нормальном железе не срабатывает —
   * визуал 1:1. low → 0.7× базового разрешения (резкий запас GPU/CPU).
   */
  private setQuality(low: boolean) {
    if (low === this.qualityLow) return;
    this.qualityLow = low;
    this.renderer.setPixelRatio(low ? Math.max(1, this.baseRatio * 0.7) : this.baseRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    this.applyBloomRes();
  }

  /** Размер bloom-пасса = половина экрана (вызывать после composer.setSize). */
  private applyBloomRes() {
    this.bloomPass?.setSize(
      Math.max(1, Math.round(innerWidth / 2)), Math.max(1, Math.round(innerHeight / 2)),
    );
  }

  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer?.setSize(innerWidth, innerHeight);
    this.applyBloomRes(); // composer.setSize сбросил на полный — вернуть половину
  };

  /**
   * Прогрев до старта: прекомпиляция шейдеров и инициализация буферов
   * постобработки. Без него первый игровой кадр компилирует шейдеры «на лету»
   * и заметно лагает — здесь это происходит под лоадером, до начала заезда.
   */
  /** endless: дождаться готовности аудио первого сегмента (reverb-IR). */
  async audioReady() {
    if (this.endless && this.chain) await this.chain.readyFirst();
  }

  warmup() {
    this.renderer.compile(this.world.scene, this.camera);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.world.scene, this.camera);
  }

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
    if (!this.paused) this.playSec += dt; // счётчик игрового времени (для титров)
    if (!this.paused) {
      // positionSec возвращает 0, пока аудио-контекст реально не играет —
      // ГАРАНТИЯ: машина не трогается без слышимого звука
      const reported = this.posSource.positionSec();
      if (!this.audioStarted) {
        if (this.posSource.isPlaying() && reported > 0) {
          this.audioStarted = true; // первый слышимый звук — поехали в синхрон
        } else {
          this.tEst = 0; // ждём звук на старте
          this.errSmooth = 0;
        }
      }
      // после старта транзиентный провал reported=0 (заминка/авто-suspend) лишь
      // замораживает часы на кадр — НЕ телепортирует машину обратно на старт
      if (this.audioStarted && reported > 0) {
        this.tEst += dt;
        const err = reported - this.tEst;
        // огромный расход (>2с) = перезапуск/seek — только тогда жёсткий сброс
        if (Math.abs(err) > 2) {
          this.tEst = reported;
          this.errSmooth = 0;
        } else {
          // СИНХРОН — суть ритм-игры: блоки стоят на тайминге нот и собираются
          // ровно когда нота звучит. tEst обязан держаться позиции звука.
          // outputLatency в Chrome дрожит кадр к кадру → сглаживаем САМ сигнал
          // ошибки (убираем дрожь), но тянем уверенно: нет ни лага, ни тряски.
          this.errSmooth += (err - this.errSmooth) * Math.min(1, dt * 8);
          this.tEst += this.errSmooth * Math.min(1, dt * 6);
        }
      }
    }
    const t = Math.max(0, this.tEst + this.audioOffset);
    // турбо «закись азота»: держишь кнопку → тратится бак и врубается визуал
    // скорости. Мобайл — авто при полном баке (нет второй руки на удержание).
    if (IS_MOBILE && this.energy >= 1 && !this.walkMode) this.nosHeld = true;
    // запускать можно ТОЛЬКО с полного бака; запущенный выпускается ДО ПОСЛЕДНЕГО
    // (отпускание кнопки не останавливает разряд). После аварии (пешком) — НЕТ турбо.
    if (this.nosHeld && this.energy >= 1 && !this.nosActive && !this.paused && !this.walkMode) {
      this.nosActive = true;
      this.conductor?.setRate(1.18, 0.3); // РЕАЛЬНЫЙ разгон ×1.18, быстрый поджиг
      this.pop('⚡ ТУРБО!', 'pop-combo pop-mega');
      this.flash('#ffd24d');
      this.shake = Math.min(0.6, this.shake + 0.4);
      this.director.spark(0.7); // турбо — сильнейший всплеск
      this.haptic([20, 30, 50]);
    }
    if (this.nosActive) {
      this.energy = Math.max(0, this.energy - dt / 6); // полный бак ≈ 6 с
      if (this.energy <= 0) {
        this.nosActive = false;
        // азот кончился — НЕ тормоз в стену: плавный накат к норме за ~1.6с
        this.conductor?.setRate(1, 1.6);
        if (IS_MOBILE) this.nosHeld = false;
      }
    }
    // вверх быстро (поджиг), вниз медленно (накат к норме по кривой, как тает азот)
    this.nosVis += ((this.nosActive ? 1 : 0) - this.nosVis) * Math.min(1, dt * (this.nosActive ? 8 : 2));

    // #18 золотые волны: внезапно ряд блоков «золотой» на ~3с — variable-ratio
    // сюрприз (×2.5 очки + золотые искры). Старт по случайному таймеру.
    if (this.nextGolden < 0) this.nextGolden = t + 18 + Math.random() * 22;
    // после аварии (пешая «другая игра») гоночных ивентов нет — золотую волну глушим
    if (!this.paused && !this.walkMode && t >= this.nextGolden && t >= this.goldenUntil) {
      this.goldenUntil = t + 3.2;
      this.nextGolden = t + 22 + Math.random() * 30;
      this.pop('🌟 ЗОЛОТАЯ ВОЛНА! ×2.5', 'pop-combo pop-mega');
      this.flash('#ffd24d');
      this.director.spark(0.6); // старт золотой волны — крупный всплеск
    }

    // #36/#35 новизна против скуки: каждые ~35–55с — смена темы/погоды (новая
    // палитра = дофамин для СДВГ). Если игрок «закис» (высокий комбо + давно без
    // аварии = слишком легко) — новизну подаём раньше + золотая волна как вызов.
    if (this.nextNovelty < 0) this.nextNovelty = t + 35 + Math.random() * 20;
    const comfortable = this.combo > 30 && (t - this.lastCrashT) > 22;
    // под сюжетным спуском (фаза ≠ race) и на подъезде к аварии (зима) новизну глушим
    if (!this.story?.active && !this.approachStarted && !this.paused
        && (t >= this.nextNovelty || (comfortable && t >= this.nextNovelty - 15))) {
      this.nextNovelty = t + 35 + Math.random() * 20;
      this.themeIndex = (this.themeIndex + 1) % THEMES.length;
      const th = THEMES[this.themeIndex];
      this.world.applyTheme(th); // только палитра/погода; районы (провинция/поле/город) идут по дистанции дороги
      this.pop(`🎨 ${th.name}`, 'pop-theme');
      if (comfortable) this.goldenUntil = Math.max(this.goldenUntil, t + 3); // вызов+награда заскучавшему
    }

    // #15/#16/#41 бит-огибающая доли (1 на удар → спад) — единый пульс для
    // камеры, мира (окна/фонари) и блума. Это и есть ритм-транс.
    if (this.endless && this.chain) {
      this.bpm = this.chain.bpmAt(t);
      this.applySfxGenre(this.chain.genreAt(t)); // тембр сбора едет за жанром цепочки
      const k = this.chain.keyAt(t); // строй сбора едет за тональностью цепочки
      if (k && (k.tonic !== this.sfxTonic || k.mode !== this.sfxMode)) {
        this.sfxTonic = k.tonic; this.sfxMode = k.mode;
        this.sfx.setKey(k.tonic, k.mode);
      }
      // лид-гид по комбо: играешь чисто (комбо растёт) → трек-лид уходит в тень,
      // мелодию несёт твой сбор; сорвал — гид возвращается и ведёт. Адаптивный микс.
      // лид-мелодия гаснет, пока ты пропускаешь: промах взводит спад (до нуля за ~1.3с),
      // любой сбор мгновенно снимает спад и возвращает полную → guide 0.12…1.0.
      // До ПЕРВОГО собранного блока мелодия полная (едешь к блоку — ничего не гаснет).
      if (!this.engaged) { this.leadHealth = 1; this.leadFading = false; }
      else if (this.leadFading) this.leadHealth = Math.max(0, this.leadHealth - dt / 1.3);
      this.conductor?.setLeadGuide(0.12 + this.leadHealth * 0.88);
    }
    const beatEnv = Math.max(0, 1 - ((t * this.bpm / 60) % 1) * 3.2);

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
      const target = 0.45 + brake * 1.9; // ночь+туман: габарит приглушён, стоп ярче
      this.tailBase += (target - this.tailBase) * Math.min(1, dt * 9);
      // лёгкое мерцание лампы накаливания — сумма негармоничных синусов, ~±3%
      const flick = 1 + (Math.sin(t * 7.3) * 0.4 + Math.sin(t * 17.1) * 0.35
        + Math.sin(t * 31.7) * 0.25) * 0.03;
      this.tailMat.emissiveIntensity = this.tailBase * flick;
      // ореол ВСЕГДА присутствует (пол 0.55), ярче при стопе. Не гаснет после старта.
      const glow = (0.55 + brake * 0.3) * flick;
      const sc = 1 + brake * 0.4;
      for (const s of this.tailGlows) {
        s.material.opacity += (glow - s.material.opacity) * Math.min(1, dt * 9);
        s.scale.set(1.3 * sc, 0.7 * sc, 1); // outer glow
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
    } else if (this.crashUntil > 0 && t < this.crashUntil) {
      dist = this.crashDist; // во время аварии мир застыл на точке съезда
    } else if (this.walkMode) {
      // пешком (лес/роща/озеро): дистанцию ведёт W, не аудио. На озере (frozen)
      // движение остановлено — сидишь и смотришь.
      if (!this.paused && !this.frozen && this.keyFwd) {
        this.walkDist += 5.0 * dt; // только ВПЕРЁД (W); назад нельзя — A/D дают стрейф
      }
      dist = this.walkDist;
    } else {
      dist = this.level.distAt(t);
    }

    // ПОДЪЕЗД К АВАРИИ. За ~450 м до леса: зона становится ПОЛЕМ и наступает
    // холодная туманная снежная зима; за ~50 м — резкий поворот в дороге (видно
    // издали, едем прямо и не вписываемся).
    if (this.story && !this.walkMode) {
      const m = this.story.metersToForest(dist);
      if (!this.approachStarted && m > 0 && m < 450) {
        this.approachStarted = true;
        this.crashArmed = true;
        this.crashSide = Math.random() < 0.5 ? -1 : 1;
        this.crashDist = dist + m;
        this.approachFromTheme = THEMES[this.themeIndex];
        this.world.setApproachField(this.crashDist, 450); // район = поле, дорога 2 полосы
        this.world.setCrashBend(this.crashDist, this.crashSide);
        // поток едет по той же изогнутой дороге (endless: трафик в сегментах цепочки)
        if (this.endless && this.chain) this.chain.setCrashBend(this.crashDist, this.crashSide);
        else this.traffic.setCrashBend(this.crashDist, this.crashSide);

        this.world.applyThemeColors(WINTER); // precip → снег
        this.world.refreshPrecip();
      }
      // плавно нагоняем зиму к моменту аварии
      if (this.approachStarted && this.approachFromTheme) {
        const k = THREE.MathUtils.clamp(1 - m / 450, 0, 1);
        this.world.applyThemeColors(lerpTheme(this.approachFromTheme, WINTER, k));
      }
    }

    // #ST сюжетный спуск: по дистанции уводим мир в сюр (тема/туман/insanity/
    // темп/нарратор). До леса Story молчит (active=false) — мир штатный.
    if (this.story && !this.paused) {
      // на берегу (frozen) мир стоит, но реплики должны идти по ВРЕМЕНИ: кормим
      // Story виртуальной дистанцией (walkDist + время сидения), не двигая мир.
      if (this.frozen) this.sitTime += dt;
      // ФИНАЛЬНЫЕ ТИТРЫ: через ~15 с после того, как встал на камень — над водой
      // всплывают титры (благодарность + время прохождения).
      if (this.frozen && !this.creditsShown && this.sitTime >= 5) {
        this.creditsShown = true;
        // склонение русского числительного (1 минуту / 2 минуты / 5 минут и т.п.)
        const plural = (n: number, one: string, few: string, many: string) => {
          const d10 = n % 10, d100 = n % 100;
          return (d10 === 1 && d100 !== 11) ? one
            : (d10 >= 2 && d10 <= 4 && !(d100 >= 12 && d100 <= 14)) ? few : many;
        };
        const m = Math.max(1, Math.round(this.playSec / 60)); // реальное время от старта (мимо пауз)
        const y = this.collected; // собранных кубиков за всю игру
        this.world.showCredits([
          'Спасибо за игру!',
          `ты прошёл её за ${m} ${plural(m, 'минуту', 'минуты', 'минут')}`,
          `и собрал ${y} ${plural(y, 'кубик', 'кубика', 'кубиков')}`,
          'Сделано Мижганом',
        ]);
        // сначала — поздравление от нарратора; висит, пока титры едут над морем
        this.narrator?.pin('Поздравляю, ты победил!');
      }
      // титры проехали (~13 с) — нарратор меняет реплику на выбор финала
      if (this.creditsShown && !this.replayPromptShown && this.sitTime >= 18) {
        this.replayPromptShown = true;
        this.narrator?.pin('Нажми Y — сыграть ещё раз · N — обычная гонка');
      }
      const storyDist = this.frozen ? this.walkDist + this.sitTime * 2.5 : dist;
      const st = this.story.tick(storyDist, THEMES[this.themeIndex]);
      this.storyCam = st.camera;
      this.frozen = st.freeze;
      // БЕСШОВНОСТЬ: пропы зон выбираются ПО ДИСТАНЦИИ (world.setZones), цвета/туман
      // лерпятся (applyThemeColors), небо переключаем явно — без мгновенной подмены.
      if ((st.enteredPhase === 'forest' || st.enteredPhase === 'grove' || st.enteredPhase === 'lake')
          && !this.zonesSet) {
        const [zf, zg, zl] = this.story.zoneStarts();
        this.world.setZones(zf, zg, zl);
        this.zonesSet = true;
      }
      if (st.propSetChanged) this.world.updateSky(st.propSet); // сияние/луна/звёзды/вода под фазу
      if (st.colors) {
        this.world.applyThemeColors(st.colors); // плавный кросс-фейд тумана/пола/воды
        if (st.rebuildPrecip) this.world.refreshPrecip();
      }
      // ВХОД В ЛЕС = АВАРИЯ и переход в «другую игру»: непроходимый поворот, машину
      // сносит и переворачивает (кинематографично, ~3.6с). Дальше — пешком: 3-е лицо,
      // орбита мыши вокруг человечка, WASD-ходьба по петляющей тропе. Без спешки.
      if (st.enteredPhase === 'forest') {
        // апекс/сторона уже заданы при армировании поворота; если прыгнули мимо
        // (Shift-jump) — задаём здесь
        if (!this.crashArmed) {
          this.crashArmed = true;
          this.crashDist = dist; this.crashSide = Math.random() < 0.5 ? -1 : 1;
          this.world.setCrashBend(this.crashDist, this.crashSide);
          if (this.endless && this.chain) this.chain.setCrashBend(this.crashDist, this.crashSide);
          else this.traffic.setCrashBend(this.crashDist, this.crashSide);
        }
        this.crashUntil = t + 3.6;
        this.flash('#ffffff');
        this.shake = Math.min(1, this.shake + 1);
        this.haptic([40, 80, 160]);
        if (!this.runner) { this.runner = new Runner(); this.world.scene.add(this.runner.group); }
        this.hideRaceHud();              // гоночный HUD (очки/скорость/комбо/ускорение) убрать — дальше другая игра
        this.showWalkHint();             // аккуратно слева-сверху: чем двигаться (само гаснет)
        this.walkMode = true;            // дистанцию дальше ведут шаги (после краша)
        this.walkDist = this.crashDist;  // СТАРТ строго на входе в лес (не аудио-дист → нет перелёта в озеро)
        this.lookYaw = 0; this.lookPitch = 0; // орбита по умолчанию — сзади, чуть сверху
        if (!this.ambient) this.ambient = new NightAmbient();
        this.ambient.fadeTo(0.85, 10);   // ночной амбиент проступает
        this.conductor?.beginDescent();  // фиксируем уровень музыки — дальше уводим её вдаль по шагам
      }
      // НЕПРЕРЫВНЫЙ УВОД МУЗЫКИ ВДАЛЬ: пока идём по лесу — музыка тише+медленнее с
      // каждым шагом (привязка к ДИСТАНЦИИ, не к таймеру: стоишь — замерла). К роще
      // (светлячки) музыки уже нет — только ночной амбиент (он идёт мимо мастера).
      if (this.walkMode) {
        const [zf, zg] = this.story.zoneStarts(); // старт леса, старт рощи
        if (this.walkDist < zg) {
          const p = THREE.MathUtils.clamp((this.walkDist - zf) / Math.max(1, zg - zf), 0, 1);
          this.conductor?.setDescent(p);
        }
      }
      if (st.enteredPhase === 'grove') this.conductor?.duckMusic(-80, 4); // добиваем в тишину (страховка)
      if (st.enteredPhase === 'lake') this.ambient?.setWater(0.9, 6);     // у озера добавляем воду
      // на колёсной фазе (race) — в машине; на пеших — пешком
      this.onFoot = st.camera !== 'chase';
      this.director.setInsanity(st.insanity);
      // темп на гонке ведёт story; в пешем спуске им владеет setDescent (плавно вниз)
      if (st.rateChanged && !this.walkMode) this.conductor?.setRate(st.audioRate, 3);
      // реплики не сыплем во время самой аварии — только когда уже стоишь/идёшь
      if (!(this.crashUntil > 0 && t < this.crashUntil)) {
        const line = this.story.pendingNarration(storyDist);
        if (line) this.narrator?.say(line);
      }
    }

    // руление мышью с плавным догоном и креном
    // быстрый догон курсора (ритм-игра), вес — в крене и довороте носа
    // предел руля следует ширине дороги (2 полосы — уже, 3 — шире)
    // в гонке руль — мышь; в пешем Firewatch-режиме мышь занята осмотром, а A/D
    // дают небольшой стрейф по тропе
    const steerInput = this.walkMode
      ? (this.frozen ? 0 : ((this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0)) * 0.7) // на камне (freeze) стрейфа нет
      : this.mouseX;
    const target = THREE.MathUtils.clamp(steerInput, -1, 1) * steerRange(this.level.wideAt(dist));
    const prevX = this.carX;
    this.carX = THREE.MathUtils.damp(this.carX, target, 14, dt);
    // боковая скорость для крена/доворота — сглажена EMA: сырой Δ/dt шумит на
    // плавающем dt и микродвижениях мыши, отчего машину мелко потряхивает
    const vxRaw = (this.carX - prevX) / Math.max(dt, 1e-4);
    this.vxSmooth += (vxRaw - this.vxSmooth) * Math.min(1, dt * 12);
    const vx = this.vxSmooth;

    // машина/камера идут по ЧИСТОЙ оси (БЕЗ изгиба-аварии): дорога сворачивает в
    // резкий поворот, а мы едем прямо и НЕ вписываемся — видно, как трасса с
    // кристаллами уходит вбок, а нас несёт прямо в лес. Изгиб остаётся в рендере
    // дороги (world.cAt) и в кристаллах (blocks), но не в нашем пути.
    const cx = this.level.curveAt(dist);
    const roadDir = (this.level.curveAt(dist + 2) - this.level.curveAt(dist - 2)) / 4;
    const y = this.groundY(dist);
    const yAhead = this.groundY(dist + 2.4);
    this.car.position.set(cx + this.carX, y, -dist);
    // нос -z: вверх = отрицательный rx; демпфер сглаживает смену уклона
    this.car.rotation.x = THREE.MathUtils.damp(
      this.car.rotation.x, -Math.atan2(yAhead - y, 2.4), 5, dt,
    );
    // нос по касательной к дороге + доворот рулём
    this.car.rotation.y = -Math.atan(roadDir) + THREE.MathUtils.clamp(-vx * 0.035, -0.4, 0.4);
    this.car.rotation.z = THREE.MathUtils.clamp(vx * 0.014, -0.14, 0.14);

    const crashing = this.crashUntil > 0 && t < this.crashUntil;
    // авария только что кончилась → машина застывает обломком, выдаём инструкцию
    if (this.crashUntil > 0 && !crashing && !this.wrecked) {
      this.wrecked = true;
      this.crashUntil = -1;
      this.wreckPos.copy(this.car.position);
      // перевёрнутая машина «крышей» уходит на ~1.4 м вниз (кузов высотой ~1.42,
      // ориджин у колёс) → поднимаем обломок, чтобы он лежал НА земле, не тонул
      this.wreckPos.y += 1.4;
      this.wreckYaw = this.car.rotation.y;
      this.world.clearCrashBend(); // дальше пешая тропа без виража-аварии
      if (this.endless && this.chain) this.chain.clearCrashBend();
      else this.traffic.clearCrashBend();
      this.pop('⌨ WASD — ИДТИ · МЫШЬ — КАМЕРА · C — ВИД', 'pop-theme pop-mega');
    }

    // мировая позиция человечка на ПЕТЛЯЮЩЕЙ тропе. Тропа (world.cAt) вьётся во ВСЕХ
    // пеших фазах (включая озеро) — человечек ДОЛЖЕН идти по той же кривой, иначе
    // расходится с полотном и уходит в воду. Поэтому weave при любом пешем виде
    // (foot/lakesit), а не только 'foot'.
    const onPath = this.storyCam !== 'chase';
    const weave = onPath ? trailWeave(dist) : 0;
    const slope = onPath ? trailWeaveSlope(dist) : 0;
    const charX = cx + this.carX + weave;
    const heading = -Math.atan(roadDir + slope); // лицом вдоль тропы

    this.shake *= Math.exp(-7 * dt);
    const shG = this.director.shakeGain();
    const shX = (Math.random() - 0.5) * this.shake * 0.3 * shG;
    const shY = (Math.random() - 0.5) * this.shake * 0.22 * shG;

    if (crashing) {
      // === КИНЕМАТОГРАФИЧНАЯ АВАРИЯ === машину сносит прямо с поворота в лес и
      // переворачивает; камера 3-го лица провожает кувырок. Сам ставит car+camera.
      this.updateCrash(t, cx, y, dt);
      if (this.runner) this.runner.group.visible = false;
    } else {
      // машина: ОБЛОМОК (перевёрнута на месте аварии, видна, можно обойти) либо
      // (гонка) — это ты
      if (this.wrecked) {
        // обломок виден только в ЛЕСУ (на месте аварии, можно обойти/оглянуться).
        // Дальше — роща/озеро — машины быть НЕ должно (иначе всплывает у воды,
        // особенно после dev-прыжка, где дистанции пере-смещены).
        const groveStart = this.story ? this.story.zoneStarts()[1] : Infinity;
        const showWreck = dist < groveStart;
        this.car.visible = showWreck;
        if (showWreck) {
          this.car.position.copy(this.wreckPos);
          // лежит на крыше, завалившись набок — колёса видны кверху
          this.car.rotation.set(Math.PI * 0.97, this.wreckYaw, this.crashSide * 0.42);
        }
      } else {
        this.car.visible = !this.onFoot;
        this.car.position.set(charX, y, -dist);
      }
      // человечек (ты) — 3-е лицо на тропе; в дебаг-1-м-лице (C) прячем тело.
      // В конце тропы (frozen) ПЛАВНО ЗАБИРАЕТСЯ на камень (runnerLift) — стоит на нём
      // над водой, а не утыкается в валун.
      const ROCK_LIFT = 1.35; // высота верха камня над берегом
      this.runnerLift = THREE.MathUtils.damp(this.runnerLift, this.frozen ? ROCK_LIFT : 0, 4, dt);
      if (this.onFoot && this.runner) {
        this.runner.group.visible = !this.fpDebug;
        this.runner.group.position.set(charX, y + this.runnerLift, -dist);
        this.runner.group.rotation.set(0, heading, 0);
        // звук шага ровно на касание стопы (runner вернёт true в этот кадр)
        if (this.runner.update(dist, this.keyFwd && !this.frozen ? 5.0 : 0)) this.sfx.footstep();
      } else if (this.runner) this.runner.group.visible = false;

      // --- камера (вне аварии) ---
      if (this.finished) {
        const fd = this.level.totalDist;
        const camPos = this.camScratch.set(
          this.level.curveAt(fd - 8) * 0.7 + this.level.curveAt(fd) * 0.3,
          this.level.heightAt(fd - 8) + 4.0, -(fd - 8.5),
        );
        this.camera.position.lerp(camPos, 1 - Math.exp(-3 * dt));
        this.camera.lookAt(cx + this.carX, y + 0.8, -dist);
      } else if (this.onFoot) {
        // ПЕШИЙ режим: 3-е лицо, ОРБИТА мыши вокруг человечка (C → дебаг 1-е лицо)
        const tx = charX, ty = y + this.runnerLift + (this.storyCam === 'lakesit' ? 0.9 : 1.2), tz = -dist;
        if (this.fpDebug) {
          const headH = this.storyCam === 'lakesit' ? 1.15 : 1.65;
          // pitch инвертируем: мышь вверх → смотрим вверх (было наоборот)
          const pitch = THREE.MathUtils.clamp(-this.lookPitch, -1.1, 0.95);
          this.camera.position.set(charX + shX * 0.3, y + headH + shY * 0.2, -dist);
          this.camera.rotation.set(pitch, heading + this.lookYaw, 0, 'YXZ');
        } else {
          const R = this.orbitR;
          const pitch = THREE.MathUtils.clamp(this.lookPitch + 0.3, 0.05, 1.25); // над горизонтом
          this.camera.position.set(
            tx + R * Math.cos(pitch) * Math.sin(this.lookYaw) + shX,
            ty + R * Math.sin(pitch) + shY,
            tz + R * Math.cos(pitch) * Math.cos(this.lookYaw),
          );
          // мышь вверх (lookPitch < 0) → поднимаем цель взгляда В НЕБО (звёзды/сияние)
          const up = Math.max(0, -this.lookPitch) * 14;
          this.camera.lookAt(tx, ty + up, tz);
        }
      } else if (this.firstPerson) {
        this.camera.position.set(cx + this.carX + shX * 0.5, y + 1.4 + shY * 0.5, -dist - 0.95);
        const look = 22;
        this.camera.lookAt(
          this.level.curveAt(dist + look) + this.carX,
          this.level.heightAt(dist + look) + 1.25, -dist - look,
        );
      } else {
        const camY = this.level.heightAt(Math.max(0, dist - 7.5)) + 4.2;
        const camTarget = this.camScratch.set(
          this.level.curveAt(Math.max(0, dist - 7.5)) + this.carX * 0.6, camY, -dist + 7.5,
        );
        this.camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt));
        this.camera.position.x += shX;
        this.camera.position.y += shY;
        this.camera.lookAt(this.level.curveAt(dist + 8) + this.carX * 0.8, y + 1.0, -dist - 8);
      }
    }
    // за кем следует мир: пешком — за игроком (charX,-dist), иначе — за машиной
    if (this.onFoot && !crashing) this.activePos.set(charX, y, -dist);
    else this.activePos.copy(this.car.position);
    // камео-флориш финиша: камера отъезжает назад-вверх и плавно возвращается
    if (this.finaleCamT >= 0) {
      const ft = t - this.finaleCamT;
      if (ft > 1.8 || ft < 0) { this.finaleCamT = -1; this.finaleEnv = 0; }
      else {
        this.finaleEnv = Math.sin(Math.min(1, ft / 1.8) * Math.PI); // 0→1→0
        this.camera.position.z += 3 * this.finaleEnv; // лёгкий отъезд назад (не в космос)
        this.camera.position.y += 1.2 * this.finaleEnv; // и чуть вверх
      }
    } else this.finaleEnv = 0;
    // турбо: лёгкий сдвиг камеры (≈1 м назад, ≈3° вверх) + чуть FOV — ощущение
    // разгона дают в основном скоростные полосы/блум/блюр, а не «отъезд»
    if (this.nosVis > 0.01) {
      this.camera.position.z += 0.12 * this.nosVis;
      this.camera.position.y -= 0.08 * this.nosVis; // чуть НИЖЕ обычного (~0.5° вниз)
    }
    // #15/#A камера «вдыхает» на долю (zoom-пульс) — канал cameraPulse дирижёра,
    // гейтирован состоянием (в холодном затишье 0 → камера не дёргается «сама»);
    // турбо-widen (nosVis) — отдельная механика, остаётся.
    const fov = 62 + 0.6 * this.nosVis - this.director.cameraPulse(beatEnv);
    if (Math.abs(fov - this.camera.fov) > 0.03) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // #ST крен/тилт камеры от «безумия» — мир кренится по мере спуска
    const ins = this.director.insanity;
    if (ins > 0.001) {
      this.camera.rotation.z += Math.sin(t * 0.7) * ins * 0.07 + Math.sin(t * 2.7) * ins * 0.025;
    }
    this.narrator?.update(dt);
    if (!this.paused) this.ambient?.update(dt); // редкие птицы по таймеру
    this.particles.update(dt);

    // блоки: сбор по позиции машины (+притяжение при магните или турбо)
    const magnetActive = t < this.magnetUntil || this.nosActive;
    const carWorldX = cx + this.carX;
    type ObsHit = ReturnType<Traffic['update']>['collided'];
    let hitObs: ObsHit = null;
    let grazed: ObsHit = null;
    let knocked: ObsHit = null;
    if (this.endless && this.chain) {
      // бесконечный сет: подвесить/снять сегменты и обойти активные. Каждый
      // сегмент сдвинут по дистанции/времени — кормим его локальными координатами
      this.chain.update(dist, t);
      // музыкальные слои: первые 4с трека — ВСЕ (интро не молчит, даже если бит
      // ещё не вступил), дальше пол = 1 (chords/counter всегда звучат), arp/fx
      // открывает комбо ≥16. Так старта в тишине не бывает.
      const introFull = this.chain.localSec(t) < 4; // интро не молчит
      const comboTier = this.combo >= 16 ? 2 : 1; // комбо ≥16 открывает arp/fx
      this.chain.setTier(introFull ? 2 : comboTier);
      // #11/#12: слой как СОБЫТИЕ — разблок звучит наградой (ран вверх), потеря
      // на срыве — мягким спадом (ран вниз), а не резким обрывом
      if (comboTier > this.lastComboTier) {
        this.sfx.riser(true);
        this.pop('🎶 НОВЫЙ СЛОЙ', 'pop-combo');
      } else if (comboTier < this.lastComboTier) {
        this.sfx.riser(false);
      }
      this.lastComboTier = comboTier;
      // церемония финиша трека: салют + камео (НЕ в пешем созерцании — сломало бы тишину)
      const seam = this.chain.lastSeamBefore(t);
      if (seam > this.lastSeamT) { this.lastSeamT = seam; if (!this.walkMode) this.finale(t); }
      const crashing = this.crashUntil > 0 && t < this.crashUntil;
      for (const seg of this.chain.active()) {
        if (this.walkMode) {
          // машины-трафик прячем ВСЕГДА (пешком/в аварии) — иначе они «летят по
          // воздуху», когда нас кувыркает. Кристаллы видны ТОЛЬКО во время аварии
          // (видно, как трасса с ними уходит в поворот), но без сбора/коллизий.
          seg.traffic.root.visible = false;
          seg.blocks.mesh.visible = crashing;
          seg.blocks.gates.visible = crashing;
          if (crashing) {
            seg.blocks.update(
              dist - seg.distOffset, carWorldX, t - seg.tOffset, dt, false, false,
              this.director.blockThrob(), () => {}, () => {},
              this.crashArmed ? (lld) => crashBend(lld + seg.distOffset, this.crashDist, this.crashSide) : undefined,
            );
          }
          continue;
        }
        const ld = dist - seg.distOffset;
        const lt = t - seg.tOffset;
        seg.blocks.update(
          ld, carWorldX, lt, dt, this.fever, magnetActive, this.director.blockThrob(),
          (b, perfect) => this.onCollect(b, perfect, t, seg.distOffset),
          () => this.onMiss(),
          // кристаллы гнутся с дорогой на повороте-аварии (локальная дист → глобальная)
          this.crashArmed ? (lld) => crashBend(lld + seg.distOffset, this.crashDist, this.crashSide) : undefined,
        );
        const r = seg.traffic.update(lt, seg.geoLevel, ld, carWorldX, this.nosActive || t < this.ramUntil);
        if (r.collided) hitObs = r.collided;
        if (r.grazed) grazed = r.grazed;
        if (r.knocked) knocked = r.knocked;
      }
    } else {
      this.blocks.update(
        dist, carWorldX, t, dt, this.fever, magnetActive, this.director.blockThrob(),
        (b, perfect) => this.onCollect(b, perfect, t, 0),
        () => this.onMiss(),
        this.crashArmed ? (d) => crashBend(d, this.crashDist, this.crashSide) : undefined,
      );
      const r = this.traffic.update(t, this.level, dist, carWorldX, this.nosActive || t < this.ramUntil);
      hitObs = r.collided;
      grazed = r.grazed;
      knocked = r.knocked;
    }

    // адаптивная интенсивность: плотность блоков и трафика по игре + финал
    if (!this.finished) this.updateIntensity(t, dt);
    if (grazed && !hitObs) {
      // #22 near-miss: близкий пролёт активирует дофамин как выигрыш — продаём
      // «впритык» микро-фризом, вспышкой и тряской
      this.score += 25;
      this.bonusNotes += 2;
      this.pop('💨 ЧУТЬ-ЧУТЬ! +25', 'pop-combo pop-risk');
      this.flash('#ffcf66');
      this.shake = Math.min(0.4, this.shake + 0.15);
      this.hitStop = Math.max(this.hitStop, 0.03);
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
          this.car.position.z, C_SHIELD, 30);
      } else {
        this.missStreak = 0;
        this.breakCombo();
        if (this.energy < 1) this.energy = 0; // авария жжёт незаполненный азот; полный бак цел (честно)
        this.score = Math.max(0, this.score - 50);
        this.sfx.crash();
        this.pop('💥', 'pop-combo pop-crash');
        this.flash('#ff4433');
        this.shake = 0.8;
        this.hitStop = 0.09;
        this.haptic(60);
        this.lastCrashT = t;
        // авария — явный сигнал «тяжело»: роняем интенсивность
        this.trackHit(false); this.trackHit(false); this.trackHit(false);
      }
    }
    // турбо снёс преграду — машина-поезд: без штрафа, искры + лёгкая тряска
    if (knocked) {
      this.pop('💥 СНЁС!', 'pop-combo pop-super');
      this.particles.burst(this.car.position.x, this.car.position.y + 0.6, this.car.position.z - 1, C_GOLD_SPARK, 24);
      this.shake = Math.min(0.5, this.shake + 0.18);
    }
    // самый длинный отрезок без аварии — для миссии «N с без аварий»
    if (!this.finished) this.noCrashSec = Math.max(this.noCrashSec, t - this.lastCrashT);

    // рекорд-призрак: детект пробития — каждый кадр (это событие, не показ)
    if (this.bestScore > 0 && !this.finished && this.score > this.bestScore
        && !this.recordBroken) {
      this.recordBroken = true;
      this.pop('🏆 РЕКОРД ПОБИТ!', 'pop-combo pop-mega');
      this.flash('#ffd24d');
      this.shake = Math.max(this.shake, 0.5);
    }

    // реальная скорость выше на множитель турбо (время трека идёт быстрее)
    const kmh = Math.round(this.level.speedAt(t) * 3.6 * (1 + 0.18 * this.nosVis));
    // HUD и комбо-полоса — ~15 Гц: на глаз неотличимо, но вчетверо меньше
    // сборки строк и DOM-записей (счёт «вздрагивает» отдельно в scoreBump)
    this.hudAcc += dt;
    if (this.hudAcc >= 0.066) {
      this.hudAcc = 0;
      // микроцель: полоска до следующей вехи комбо
      let lo = 0, hi = 5;
      if (this.combo >= 50) { lo = 50 + Math.floor((this.combo - 50) / 25) * 25; hi = lo + 25; }
      else {
        for (let i = 0; i < MILESTONES.length - 1; i++)
          if (this.combo >= MILESTONES[i] && this.combo < MILESTONES[i + 1]) {
            lo = MILESTONES[i]; hi = MILESTONES[i + 1];
          }
      }
      this.comboBarFill.style.width = `${((this.combo - lo) / (hi - lo)) * 100}%`;

      // #23/#24 микро-цель: прогресс к мелкому таргету (полоска почти полна часто)
      if (this.goal) {
        let prog = 0;
        if (this.goal.kind === 'collect') prog = this.collected - this.goal.base;
        else if (this.goal.kind === 'combo') prog = this.combo;
        else if (this.goal.kind === 'perfect') prog = this.perfectStreak;
        else prog = t - this.lastCrashT;
        if (prog >= this.goal.target) this.completeGoal();
        else this.goalEl.textContent = `🎯 ${this.goal.label} · ${Math.max(0, Math.floor(prog))}/${this.goal.target}`;
      }

      // #20 комбо-кольцо: заполнение до вехи, цвет/центр по fever+овердрайву
      const od = this.overdrive;
      const mult = (1 + this.feverLevel) * (od ? 2 : 1);
      const ringC = od ? '#ffd24d'
        : this.feverLevel >= 3 ? '#ff8a3c'
        : this.feverLevel >= 2 ? '#ff44ff'
        : this.feverLevel >= 1 ? '#c14dff' : '#22ffee';
      this.comboRing.style.setProperty('--rp', String(Math.round(((this.combo - lo) / (hi - lo)) * 100)));
      this.comboRing.style.setProperty('--rc', ringC);
      this.comboRingLabel.textContent = mult > 1 ? `×${mult}` : (this.combo > 1 ? String(this.combo) : '');
      this.comboRingWrap.classList.toggle('on', this.combo > 1 || this.feverLevel > 0 || od);

      // #19 турбо «закись азота»: бак показывает заряд (тратится в реале, пока
      // держишь). Икона ⚡, подсветка готовности, текст-подсказка, оверлей полос.
      const ready = this.energy >= 1 && !od;
      this.odFill.style.width = `${Math.min(100, this.energy * 100)}%`;
      this.odBar.classList.toggle('on', od || this.energy > 0.02);
      this.odBar.classList.toggle('ready', ready);
      this.odBar.classList.toggle('active', od);
      this.odIcon.classList.toggle('on', od || this.energy > 0.02);
      this.odIcon.classList.toggle('hot', ready || od);
      // «(ЛКМ)» — только когда бак полон (тратить можно лишь с полного)
      this.odIcon.textContent = (ready && !IS_MOBILE) ? '⚡ УСКОРЕНИЕ (ЛКМ)' : '⚡ УСКОРЕНИЕ';
      // подсказку готовности не показываем (бесит) — только «ТУРБО!» при активе
      this.odPrompt.classList.toggle('on', od);
      if (od) this.odPrompt.textContent = '⚡ ТУРБО!';
      // блюр скорости по краям: радиус растёт с интенсивностью турбо
      this.turboFx.style.opacity = this.nosVis > 0.02 ? '1' : '0';
      this.turboFx.style.setProperty('--tb', `${(this.nosVis * 7).toFixed(1)}px`);

      // #19/fever/#A: края экрана централизованно (овердрайв > fever > пре-fever).
      // Канал feverEdge дирижёра: gain=0 — выкл; gain масштабирует пре-fever глоу.
      const eg = this.director.edgeGain();
      if (eg <= 0) {
        if (this.feverEdgeCls !== 'fever-edge') { this.feverEdge.className = 'fever-edge'; this.feverEdgeCls = 'fever-edge'; }
        this.feverEdge.style.opacity = '0';
      } else {
        const edge = (od || this.finaleEnv > 0.1) ? 'fever-edge on overdrive' // золото на финале/турбо
          : this.feverLevel ? `fever-edge on lvl${this.feverLevel}` : 'fever-edge';
        if (edge !== this.feverEdgeCls) { this.feverEdge.className = edge; this.feverEdgeCls = edge; }
        this.feverEdge.style.opacity =
          (!od && this.feverLevel === 0 && this.combo >= 10) ? String(((this.combo - 9) / 6) * 0.5 * eg) : '';
      }

      let recPart = '';
      if (this.bestScore > 0 && !this.finished) {
        recPart = this.score > this.bestScore
          ? ` · 🏆 +${this.score - this.bestScore}`
          : ` · 🏆 −${this.bestScore - this.score}`;
      }
      const hud =
        `${this.score} очков${this.combo > 1 ? ` · x${this.combo}` : ''}` +
        `${this.nosActive ? ' · ⚡ТУРБО' : ''}` +
        `${this.sessionHeat > 0 ? ` · 🔥разогрев ×${(1 + Math.min(this.sessionHeat, 30) * 0.05).toFixed(2)}` : ''}` +
        `${this.fever ? ` · 🔥x${1 + this.feverLevel}` : ''}` +
        `${magnetActive ? ` · 🧲${Math.ceil(this.magnetUntil - t)}с` : ''}` +
        `${t < this.tripleUntil ? ` · ✖3 ${Math.ceil(this.tripleUntil - t)}с`
          : t < this.doubleUntil ? ` · ✖2 ${Math.ceil(this.doubleUntil - t)}с` : ''}` +
        `${t < this.ramUntil ? ` · 🚂${Math.ceil(this.ramUntil - t)}с` : ''}` +
        `${this.shielded ? ' · 🛡' : ''}` +
        recPart +
        // endless: без таймера трека — сессия «не считает время» (запрос игрока)
        (this.endless ? ` · ${kmh} км/ч` : ` · ${kmh} км/ч · ${fmtTime(t)} / ${fmtTime(this.level.durationSec)}`);
      if (hud !== this.lastHud) { this.hud.textContent = hud; this.lastHud = hud; }
    }

    // #A дирижёр интенсивности: всё освещение картинки тянем через один arousal,
    // чтобы в затишье оно проседало к серому ночному базису, а пики были редки.
    // #39 energyAt 0..1 — динамика секции (ярче на пиках музыки, мягче в затишье)
    const energy = this.level.energyAt(t);
    if (!this.paused) {
      this.director.setHeat(this.sessionHeat);
      this.director.update(dt, beatEnv, this.feverLevel, this.nosVis, energy);
    }

    // неон дышит в бит через arousal; присваиваем только при заметном изменении
    if (this.bloomPass && !this.paused) {
      const s = this.director.bloomStrength(this.finaleEnv);
      if (Math.abs(s - this.bloomPass.strength) > 0.003) this.bloomPass.strength = s;
    }

    // #44 палитра «разогревается» на пиках arousal, остывает в затишье
    if (!this.paused) this.renderer.toneMappingExposure = this.director.exposure();
    // ВАЖНО: пешком мир (чанки/светлячки/звёзды/небо/вода) следует за ИГРОКОМ, а
    // не за машиной — иначе после аварии всё центрируется у неподвижного обломка.
    this.world.update(dt, this.activePos, this.director.worldPulse(beatEnv)); // #16/#A пульс мира — канал worldPulse дирижёра
    // #ST глитч-слой: один шейдер гонится insanity. На мобайле composer'а нет →
    // дешёвый CSS-фильтр на канвасе как запасной «слом картинки».
    if (this.glitchPass) {
      this.glitchPass.uniforms.uInsanity.value = ins;
      this.glitchPass.uniforms.uTime.value = t;
      this.glitchPass.uniforms.uAspect.value = this.camera.aspect;
    } else if (this.story) {
      this.renderer.domElement.style.filter = ins > 0.001
        ? `hue-rotate(${ins * 40}deg) saturate(${1 + ins * 0.8}) contrast(${1 + ins * 0.25})`
        : '';
    }
    if (this.composer) this.composer.render();
    else this.renderer.render(this.world.scene, this.camera);

    // дебаг FPS + скорость раз в секунду (нужен до релиза — НЕ УДАЛЯТЬ)
    if (dt > 0) this.fpsEMA += (1 / dt - this.fpsEMA) * 0.1;
    // PERF-МЕТРИКА: реальные столлы главного потока (dt зажат 0.05 → ≥0.049 =
    // кадр ≥50мс). НЕ УДАЛЯТЬ.
    if (dt >= 0.049 && this.audioStarted && !this.paused) {
      console.warn(`[jank] STALL≥50ms t=${t.toFixed(1)} seamΔ=${(t - this.lastSeamT).toFixed(1)}s`);
    }

    // авто-деградация: FPS<45 ~2с подряд → ниже качество; FPS>55 ~4с → вернуть
    if (!this.paused && !this.finished) {
      if (this.fpsEMA < 45) { this.lowFpsAcc += dt; this.highFpsAcc = 0; }
      else if (this.fpsEMA > 55) { this.highFpsAcc += dt; this.lowFpsAcc = 0; }
      else { this.lowFpsAcc = 0; this.highFpsAcc = 0; }
      if (!this.qualityLow && this.lowFpsAcc > 2) this.setQuality(true);
      else if (this.qualityLow && this.highFpsAcc > 4) this.setQuality(false);
    }

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
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    removeEventListener('mouseup', this.onMouseUp);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    if (this.pointerLocked) document.exitPointerLock();
    if (this.endless && this.chain) this.chain.dispose();
    else { this.blocks.dispose(); this.traffic.dispose(); }
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
    this.comboRingWrap.remove();
    this.odBar.remove();
    this.odIcon.remove();
    this.odPrompt.remove();
    this.turboFx.remove();
    this.goalEl.remove();
    this.narrator?.dispose();
    this.runner?.dispose();
    this.ambient?.dispose();
    this.renderer.domElement.style.filter = '';
  }
}
