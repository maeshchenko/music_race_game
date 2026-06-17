/**
 * Дирижёр интенсивности картинки. Единое СОСТОЯНИЕ возбуждения (`arousal`/`glow`)
 * + реестр КАНАЛОВ эффектов (`fx`). Каждый визуальный «juice»-эффект — отдельная
 * сущность: включается/выключается и регулируется по силе независимо, в любых
 * комбинациях. Но все они СВЯЗАНЫ одним состоянием — поэтому картинка дышит как
 * целое, а не набором рассинхронных метрономов.
 *
 * Состояние — двухслойное (запрос игрока: «не серость постоянно, ни золото
 * постоянно — должно разгоняться и регулироваться»):
 *   • baseline — МЕДЛЕННЫЙ разогрев сессии. Тихо/серо в начале, теплее с часами
 *     игры. Растёт от тиров sessionHeat, насыщается (~0.4) — даже долгая сессия
 *     не выходит на постоянный максимум.
 *   • excite — БЫСТРЫЙ событийный всплеск (perfect/золото/турбо/финиш). Спадает
 *     за пару секунд. Рефрактерное окно гасит слипание соседних пиков в вечный
 *     максимум: второй всплеск подряд бьёт слабее. Пик остаётся пиком.
 *
 * Два производных сигнала:
 *   • arousal — состояние + бит-дрожь. Для НЕПРЕРЫВНЫХ эффектов (блум/экспозиция/
 *     искры): живёт каждый кадр.
 *   • glow — состояние БЕЗ бит-дрожи (база+всплески). Для БИТ-ПУЛЬСА (окна/камера/
 *     блоки): в холодном затишье glow≈0 → пульс не «сам по себе», мир неподвижен;
 *     просыпается с разогревом/событиями.
 */

/** Имена каналов эффектов (каждый — отдельная регулируемая сущность). */
export type FxName =
  | 'bloom'        // блум-свечение неона
  | 'exposure'     // теплота палитры (тонмаппинг)
  | 'sparks'       // плотность искр/салюта при сборе
  | 'worldPulse'   // дыхание окон/фонарей в бит
  | 'cameraPulse'  // FOV-вдох камеры в бит (zoom вперёд-назад)
  | 'blockThrob'   // пульсация размера блоков
  | 'cameraShake'  // тряска камеры на событиях
  | 'feverEdge';   // виньетка краёв экрана (fever/combo)

/** Канал эффекта: вкл/выкл + множитель силы. */
export interface FxChannel { on: boolean; gain: number; }

export class IntensityDirector {
  /** Текущая интенсивность 0..1 — состояние + бит-дрожь (непрерывные эффекты). */
  arousal = 0;
  private baseline = 0;
  private excite = 0;
  private refractory = 0;

  /**
   * «Безумие» 0..1 — сюжетный спуск (story.ts). Отдельный медленный скаляр НАД
   * arousal: гонит крен камеры, глитч-шейдер, дрейф цвета/детюна. Story задаёт
   * ЦЕЛЬ (setInsanity), здесь плавно лерпим — переходы фаз без ступенек.
   */
  insanity = 0;
  private insanityTarget = 0;

  /**
   * Реестр каналов: правь `.on` (вкл/выкл) и `.gain` (сила, 0..N) у любого —
   * комбинируются свободно. gain=1 — штатно, 0 — выключено, >1 — усилено.
   */
  readonly fx: Record<FxName, FxChannel> = {
    bloom:       { on: true, gain: 1 },
    exposure:    { on: true, gain: 1 },
    sparks:      { on: true, gain: 1 },
    worldPulse:  { on: true, gain: 1 },
    cameraPulse: { on: true, gain: 1 },
    blockThrob:  { on: true, gain: 1 },
    cameraShake: { on: true, gain: 1 },
    feverEdge:   { on: true, gain: 1 },
  };

  /** Эффективная сила канала: 0 если выключен, иначе gain. */
  private g(n: FxName): number {
    const c = this.fx[n];
    return c.on ? c.gain : 0;
  }

  // --- состояние ----------------------------------------------------------

  /** Обновить медленную базу по разогреву сессии (тиры sessionHeat, 0..30+). */
  setHeat(tiers: number) {
    // насыщение: 0 тиров → 0; длинная сессия → ~0.4 (теплеет, но не пик)
    this.baseline = 0.4 * (1 - Math.exp(-tiers * 0.14));
  }

  /** Цель «безумия» 0..1 (сюжетная фаза). Лерпится в update(). */
  setInsanity(x: number) { this.insanityTarget = Math.max(0, Math.min(1, x)); }

  /** Событийный всплеск возбуждения. s 0..1 (сила события). */
  spark(s: number) {
    const gain = this.refractory > 0 ? 0.4 : 1; // рефрактер: пики не слипаются
    this.excite = Math.min(1, this.excite + s * gain);
    this.refractory = 0.7;
  }

  /**
   * Кадровое обновление. live-вклады (бит/турбо/энергия секции) «дышат», но НЕ
   * запоминаются — добавляются только в текущем кадре, поэтому в затишье картинка
   * проседает к базису, а не висит на максимуме.
   */
  update(dt: number, beatEnv: number, fever: number, nosVis: number, energy: number) {
    this.excite -= this.excite * Math.min(1, dt * 0.9); // спад ~2.5с
    if (this.refractory > 0) this.refractory = Math.max(0, this.refractory - dt);
    const live = Math.min(
      1,
      beatEnv * beatEnv * 0.16 * (1 + fever * 0.3) + nosVis * 0.6 + energy * 0.12,
    );
    const peak = Math.max(this.excite, live);
    this.arousal = Math.min(1, this.baseline + peak * (1 - this.baseline));
    // безумие: медленный догон цели (~1.5с на полный ход) — плавный спуск
    this.insanity += (this.insanityTarget - this.insanity) * Math.min(1, dt * 0.7);
  }

  /**
   * «Свечение» 0..1 = база + всплески, БЕЗ бит-дрожи. Глубина бит-пульса (мир/
   * камера/блоки): в холодном затишье ≈0 — пульс не «сам по себе».
   */
  glow(): number {
    return Math.min(1, this.baseline + this.excite);
  }

  /** Гейтированный бит-пульс 0..1: метроном, утихающий в холодном затишье. */
  private beat(beatEnv: number): number {
    return beatEnv * this.glow();
  }

  // --- выходы по каналам --------------------------------------------------

  /** Сила блума: серый ночной низ 0.30 → пик ~1.55; финиш-климакс поверх всего. */
  bloomStrength(finaleEnv: number): number {
    return 0.3 + this.arousal * 1.25 * this.g('bloom') + finaleEnv * 0.9;
  }

  /** Экспозиция тонмаппинга: спокойно холоднее, на пиках теплее. */
  exposure(): number {
    return 1.0 + this.arousal * 0.26 * this.g('exposure');
  }

  /** Множитель плотности искр/салюта 0.5..1 — спектакль как акцент, не фон. */
  sparkScale(): number {
    return 0.5 + this.arousal * 0.5 * this.g('sparks');
  }

  /** Глубина дыхания мира (окна/фонари) в бит, гейтирована состоянием. */
  worldPulse(beatEnv: number): number {
    return this.beat(beatEnv) * this.g('worldPulse');
  }

  /** FOV-вдох камеры на долю (градусы), гейтирован состоянием. */
  cameraPulse(beatEnv: number): number {
    return this.beat(beatEnv) * 0.7 * this.g('cameraPulse');
  }

  /** Амплитуда пульсации блоков 0..1 (множитель базового pulseAmp). */
  blockThrob(): number {
    return this.glow() * this.g('blockThrob');
  }

  /** Множитель силы тряски камеры (0 — выкл). */
  shakeGain(): number {
    return this.g('cameraShake');
  }

  /** Множитель непрозрачности виньетки краёв (0 — выкл). */
  edgeGain(): number {
    return this.g('feverEdge');
  }
}
