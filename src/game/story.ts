import * as THREE from 'three';
import type { WorldTheme, PropSetId } from './world';

/**
 * «Съезд» — заезд начинается обычной аудиосёрф-гонкой и через аварию уходит в
 * лиричный игрофильм (ориентир — Firewatch; от Stanley Parable — характер
 * нарратора и слом правил, но БЕЗ безысходности). Арка по дистанции:
 *
 *   гонка → [непроходимый поворот, машину сносит] → лес пешком (машина разбита,
 *   плутаешь) → роща (бег→шаг, от 1-го лица, светлячки + северное сияние, лес
 *   расцветает) → озеро (садишься на берег, движение стоп, созерцание).
 *
 * Два слоя: очевидный — сломали правила, попали в фантазию; скрытый (НИКОГДА не
 * проговаривается) — красивый лимб после аварии. Сценарий:
 * docs/surreal-descent-scenario.md.
 *
 * Story живёт внутри обычного бесконечного заезда: молчит в фазе `race` (мир
 * штатный, новизна тем работает), на пороге леса берёт руль. Ось — ДИСТАНЦИЯ.
 */

export type Phase = 'race' | 'forest' | 'grove' | 'lake';
// chase — гонка (сзади-сверху); foot — пешком, 3-е лицо с ОРБИТОЙ мыши вокруг
// человечка; lakesit — сидя у воды, орбита мыши, движение остановлено
export type StoryCam = 'chase' | 'foot' | 'lakesit';

interface NarrCue { atOff: number; text: string } // atOff — метры от начала фазы

export interface PhaseDef {
  phase: Phase;
  startDist: number; // метры вдоль трассы, где фаза начинается
  blendIn: number;   // метры кросс-фейда палитры на входе
  theme: WorldTheme | null; // null (race) — не трогаем штатную тему/новизну
  propSet: PropSetId; // словарь декора
  insanity: number;  // цель 0..1 для глитч-слоя (в лиричной арке ≈0)
  audioRate: number; // множитель темпа (conductor.setRate)
  camera: StoryCam;
  freezeAfter?: number; // метры в фазе, после которых движение СТОП (озеро)
  narrate: NarrCue[];
}

// --- темы фаз (отдельно от THEMES, чтобы не попадали в случайную новизну) ----

// яркость подобрана так, чтобы НОЧЬЮ ВСЁ БЫЛО ВИДНО (лунная ночь, не чернота):
// высокий hemi, не слишком близкий туман, светящиеся грибы/сияние/луна добавляют.
// Подъезд к аварии — ВСЕГДА холодная туманная снежная морозная зимняя ночь.
export const WINTER: WorldTheme = {
  name: 'морозная зима', fog: 0x303a46, fogNear: 14, fogFar: 115,
  hemiSky: 0x8490a4, hemiGround: 0x303843, hemiIntensity: 1.4,
  lamp: 0xcfe0ff, precip: 'snow', precipColor: 0xeaf2ff,
};

const FOREST: WorldTheme = { // лунный лес после аварии: видно тропу и деревья
  name: 'лес', fog: 0x1d3a2c, fogNear: 19, fogFar: 178,
  hemiSky: 0x6e9a7c, hemiGround: 0x2a4234, hemiIntensity: 2.15,
  lamp: 0x9bffba, precip: 'clear', precipColor: 0x9fe89f,
  floor: 0x2a4030, path: 0x282013, pathGlow: 0x1c2e26, // тёмная тропа, еле светится лунным — видно маршрут
};
const GROVE: WorldTheme = { // роща расцветает: синь, сияние, светлячки — светло и живо
  name: 'роща', fog: 0x274868, fogNear: 24, fogFar: 215,
  hemiSky: 0x76a2d0, hemiGround: 0x3c5a78, hemiIntensity: 2.95,
  lamp: 0xaaffcc, precip: 'fireflies', precipColor: 0xffe2a0,
  floor: 0x284258, path: 0x282215, pathGlow: 0x223a40, // тёмная тропа, еле светится холодным — ведёт через рощу
};
const LAKE: WorldTheme = { // ночное озеро: открыто к луне, лунный свет на воде
  name: 'озеро', fog: 0x274866, fogNear: 28, fogFar: 300,
  hemiSky: 0x74a0c6, hemiGround: 0x3a5a78, hemiIntensity: 2.75,
  lamp: 0xbfd8ff, precip: 'fireflies', precipColor: 0xffe2a0,
  // floor = БЕРЕГ (трава/песок — по нему идём), water = сама гладь озера (отдельный план)
  floor: 0x2c3a2c, path: 0x232619, water: 0x1e4a6e, pathGlow: 0x223a40, // тёмная тропа, еле светится у берега
};

export const PHASES: PhaseDef[] = [
  { phase: 'race', startDist: 0, blendIn: 1, theme: null, propSet: 'province', insanity: 0, audioRate: 1, camera: 'chase',
    narrate: [ // распорядитель: «правильная» игра, директивы, потом непроходимый поворот
      { atOff: 700, text: 'Супер!' },
      { atOff: 2000, text: 'Хорошо идешь!' },
      { atOff: 3920, text: 'Погоди, дорога резко уходит вбок. Сбрасывай!' },
      { atOff: 3975, text: 'Тормози!' },
    ] },
  // ЛЕС/РОЩА/ОЗЕРО — ПЕШИЕ фазы (отдельная «игра»): первое лицо, ходьба
  // клавишами (~3 м/с), петляющая тропа, никакого трафика. Дистанцию ведут шаги,
  // поэтому offset'ы маленькие (метры пешком). Краш и смена управления — на входе
  // в лес (в game.ts). После аварии — БЕЗ спешки: стоишь, смотришь на свою машину.
  // ПЕШИЕ зоны короткие: ≤~1 мин ходьбы каждая (шаг ~4.5 м/с → зона ~250 м).
  { phase: 'forest', startDist: 4000, blendIn: 110, theme: FOREST, propSet: 'forest', insanity: 0, audioRate: 0.55, camera: 'foot',
    narrate: [ // после краша (реплики gated, пока идёт авария): растерян, мягчает, учит
      { atOff: 0, text: '…Машина всмятку. Кажется для нас гонка закончилась' },
      { atOff: 40, text: 'Ехать больше не на чем. Дальше только пешком.' },
      { atOff: 90, text: 'Я не создавал этот маршрут. И этот лес… Откуда он здесь?' },
    ] },
  { phase: 'grove', startDist: 4150, blendIn: 90, theme: GROVE, propSet: 'grove', insanity: 0, audioRate: 0.4, camera: 'foot',
    narrate: [ // лес расцветает; голос удивлён красотой, теплеет
      { atOff: 0, text: 'Смотри. Светлячки. Я и не знал, что они здесь есть.' },
      { atOff: 120, text: 'И птицы…' },
    ] },
  { phase: 'lake', startDist: 4300, blendIn: 90, theme: LAKE, propSet: 'lake', insanity: 0, audioRate: 0.3, camera: 'lakesit', freezeAfter: 70,
    narrate: [ // берег: доходишь (~70 м), садишься (freeze), дальше реплики ПО ВРЕМЕНИ
      { atOff: 0, text: 'Тут и море есть, надо же' },
      { atOff: 50, text: 'Похоже дальше только луна, вода и тишина.' },
      { atOff: 150, text: 'И никуда не нужно спешить.' },
    ] },
];

/** Снимок состояния спуска на кадр — Game применяет к миру/звуку/нарратору. */
export interface StorySnap {
  active: boolean;        // false пока идёт фаза race (мир штатный)
  phase: Phase;
  colors: WorldTheme | null; // интерполированная палитра — applyThemeColors (дёшево)
  rebuildPrecip: boolean; // true один кадр, когда сменился тип осадков → refreshPrecip
  propSet: PropSetId;     // словарь декора
  propSetChanged: boolean; // true один кадр при смене — Game зовёт world.setPropSet
  insanity: number;       // цель безумия (≈0 в лиричной арке)
  audioRate: number;      // множитель темпа
  rateChanged: boolean;   // true когда rate отличается от прошлого кадра
  camera: StoryCam;
  freeze: boolean;        // движение остановлено (озеро, после freezeAfter)
  enteredPhase: Phase | null; // не-null в кадр входа в новую фазу (для краша/флеша)
}

const _a = new THREE.Color();
const _b = new THREE.Color();
const lerpHex = (from: number, to: number, k: number): number =>
  _a.setHex(from).lerp(_b.setHex(to), k).getHex();

/** Интерполяция палитры from→to на долю k (для плавного кросс-фейда фаз). */
export function lerpTheme(from: WorldTheme, to: WorldTheme, k: number): WorldTheme {
  const L = (a: number, b: number) => a + (b - a) * k;
  return {
    name: to.name,
    fog: lerpHex(from.fog, to.fog, k),
    fogNear: L(from.fogNear, to.fogNear),
    fogFar: L(from.fogFar, to.fogFar),
    hemiSky: lerpHex(from.hemiSky, to.hemiSky, k),
    hemiGround: lerpHex(from.hemiGround, to.hemiGround, k),
    hemiIntensity: L(from.hemiIntensity ?? 1, to.hemiIntensity ?? 1),
    lamp: lerpHex(from.lamp, to.lamp, k),
    precip: to.precip, // тип осадков сразу целевой (refreshPrecip на входе)
    precipColor: to.precipColor,
    // пол/полотно/вода — лерпим, если заданы у обеих (плавный кросс-фейд зон)
    floor: from.floor !== undefined && to.floor !== undefined ? lerpHex(from.floor, to.floor, k) : to.floor,
    path: from.path !== undefined && to.path !== undefined ? lerpHex(from.path, to.path, k) : to.path,
    water: from.water !== undefined && to.water !== undefined ? lerpHex(from.water, to.water, k) : to.water,
    pathGlow: from.pathGlow !== undefined && to.pathGlow !== undefined ? lerpHex(from.pathGlow, to.pathGlow, k) : to.pathGlow,
  };
}

export class Story {
  private idx = 0;            // индекс активной фазы в PHASES
  private bias = 0;          // сдвиг дистанции для dev-прыжков (jumpTo)
  private lastDist = 0;
  private blendFrom: WorldTheme | null = null; // тема, ИЗ которой летим (для лерпа)
  private lastRate = 1;
  private lastPropSet: PropSetId = 'province';
  private firedTo = 0;        // сколько реплик активной фазы уже показано
  /** Стартовая тема обычной игры (THEMES[idx]) — сид для первого кросс-фейда. */
  raceTheme: WorldTheme | null = null;

  /** Активна ли сюжетная фаза (≠ race) — Game глушит новизну тем. */
  get active(): boolean { return PHASES[this.idx].phase !== 'race'; }
  get phase(): Phase { return PHASES[this.idx].phase; }

  /** Dev-прыжок к фазе по имени или индексу 1..4 — мгновенно через bias. */
  jumpTo(p: Phase | number) {
    const i = typeof p === 'number'
      ? Math.max(0, Math.min(PHASES.length - 1, p - 1))
      : PHASES.findIndex((x) => x.phase === p);
    if (i < 0) return;
    this.bias = PHASES[i].startDist - this.lastDist + 1;
  }

  /** Границы пеших зон в РЕАЛЬНОЙ дистанции (startDist − bias). Для world.setZones. */
  zoneStarts(): [number, number, number] {
    const sd = (p: Phase) => (PHASES.find((x) => x.phase === p)?.startDist ?? 0) - this.bias;
    return [sd('forest'), sd('grove'), sd('lake')];
  }

  /** Метры до поворота-аварии (леса) с учётом dev-сдвига; Infinity если уже в лесу+. */
  metersToForest(dist: number): number {
    if (this.idx > 0) return Infinity; // уже лес или дальше
    const f = PHASES.find((p) => p.phase === 'forest');
    return f ? f.startDist - (dist + this.bias) : Infinity;
  }

  /** Dev (клавиша Z): встать за metersBefore метров до поворота-аварии (лес). */
  approachForest(metersBefore: number) {
    const f = PHASES.find((p) => p.phase === 'forest');
    if (!f) return;
    this.bias = (f.startDist - metersBefore) - this.lastDist;
  }

  /** Кадровое обновление. fromTheme — текущая штатная тема (сид кросс-фейда). */
  tick(dist: number, fromTheme: WorldTheme): StorySnap {
    this.lastDist = dist;
    this.raceTheme = fromTheme;
    const eff = dist + this.bias;

    // найти активную фазу (фазы отсортированы по startDist)
    let i = this.idx;
    while (i + 1 < PHASES.length && eff >= PHASES[i + 1].startDist) i++;
    while (i > 0 && eff < PHASES[i].startDist) i--;

    let enteredPhase: Phase | null = null;
    let rebuildPrecip = false;
    if (i !== this.idx) {
      // вход в новую фазу: сид кросс-фейда = тема, из которой уходим
      const prev = PHASES[this.idx];
      this.blendFrom = prev.theme ?? fromTheme;
      this.idx = i;
      this.firedTo = 0;
      enteredPhase = PHASES[i].phase;
      const tgt = PHASES[i].theme;
      const fromPrecip = (this.blendFrom ?? fromTheme).precip;
      if (tgt && tgt.precip !== fromPrecip) rebuildPrecip = true;
    }

    const p = PHASES[i];
    let colors: WorldTheme | null = null;
    if (p.theme) {
      const from = this.blendFrom ?? fromTheme;
      const k = Math.max(0, Math.min(1, (eff - p.startDist) / p.blendIn));
      colors = lerpTheme(from, p.theme, k);
    }

    const rateChanged = Math.abs(p.audioRate - this.lastRate) > 1e-3;
    if (rateChanged) this.lastRate = p.audioRate;
    const propSetChanged = p.propSet !== this.lastPropSet;
    if (propSetChanged) this.lastPropSet = p.propSet;
    const freeze = p.freezeAfter != null && (eff - p.startDist) >= p.freezeAfter;

    return {
      active: p.phase !== 'race',
      phase: p.phase,
      colors,
      rebuildPrecip,
      propSet: p.propSet,
      propSetChanged,
      insanity: p.insanity,
      audioRate: p.audioRate,
      rateChanged,
      camera: p.camera,
      freeze,
      enteredPhase,
    };
  }

  /** Следующая невыданная реплика активной фазы (atOff достигнут). null — нет. */
  pendingNarration(dist: number): string | null {
    const p = PHASES[this.idx];
    const eff = dist + this.bias;
    const cue = p.narrate[this.firedTo];
    if (cue && eff - p.startDist >= cue.atOff) {
      this.firedTo++;
      return cue.text;
    }
    return null;
  }
}
