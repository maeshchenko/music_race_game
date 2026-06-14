import * as THREE from 'three';
import type { Song } from 'midi-gen/core';
import type { Level } from './level';
import { buildBeatGrid, extractRhythm, classifyTick } from './rhythm';
import { getArchTemplate, getArchScale, getArchBaseY } from './assets';

/** Сила доли блока: размер + пульс-кик. */
export type BeatType = 'strong' | 'weak' | 'off' | 'solo';
/** Голос блока: что озвучивает сбор (дубль реального события трека) + цвет. */
export type Voice = 'lead' | 'bass' | 'kick' | 'snare';

/**
 * Неоновые блоки: единый собираемый поток. Одновременные ноты склеиваются
 * в один блок-«аккорд» (крупнее, дороже), полоса ведётся мелодическим
 * контуром с ограничением достижимости — машина всегда успевает
 * перестроиться. Дальние прыжки (край→край) — только хард, редко.
 */

const LANE_X = 2.7; // три полосы: -2.7, 0, +2.7
const COLLECT_LATERAL = 1.45;
const CLUSTER_SEC = 0.09; // ноты ближе — один блок-аккорд

/** Сложность: плотность потока и подвижность дорожки. */
export type Difficulty = 'light' | 'norm' | 'hard';
const DIFF_CFG: Record<Difficulty, {
  beats: BeatType[]; // какие доли ритма берём (по силе)
  laneShiftGap: number; // мин. время между сменами полосы, с
  maxPerSec: number; // кап плотности блоков
  farJump: boolean; // разрешён ли прыжок край→край
}> = {
  // ритм-слой по силе доли (проще — сильные, сложнее — +бэкбит, +офф). Мелодия
  // (lead) идёт ВСЕГДА поверх — она и есть «песня, которую ты играешь».
  // плотность держим выше: СДВГ-режим любит частое подкрепление, промах нейтрален.
  light: { beats: ['strong'], laneShiftGap: 0.6, maxPerSec: 3.2, farJump: false },
  norm: { beats: ['strong', 'weak'], laneShiftGap: 0.42, maxPerSec: 4.6, farJump: false },
  hard: { beats: ['strong', 'weak', 'off'], laneShiftGap: 0.34, maxPerSec: 6.5, farJump: true },
};

const FAR_JUMP_COOLDOWN = 15; // с

export const LANE_COLORS = [
  new THREE.Color('#22ffee'), // циан
  new THREE.Color('#ff44ff'), // маджента
  new THREE.Color('#66ff66'), // лайм
];
export const LANE_CSS = ['#22ffee', '#ff44ff', '#66ff66'];

/** Цвет блока по ГОЛОСУ — видно, какой инструмент озвучишь сбором. */
export const VOICE_COLORS: Record<Voice, THREE.Color> = {
  lead: new THREE.Color('#c14dff'), // фиолет — мелодия (её ты «играешь»)
  bass: new THREE.Color('#3a7bff'), // синий — бас
  kick: new THREE.Color('#ff5a3c'), // красно-оранж — бочка (сильный удар)
  snare: new THREE.Color('#22ffee'), // циан — снейр (бэкбит)
};
export const VOICE_CSS: Record<Voice, string> = {
  lead: '#c14dff', bass: '#3a7bff', kick: '#ff5a3c', snare: '#22ffee',
};
/** ВРЕМЕННЫЙ тумблер: true — исходный вид блоков (желейные крутящиеся additive-кубы,
 *  как было ДО правок); false — призрачные шары + арки-ворота. Ничего не удалено,
 *  обе ветки живут рядом. */
const LEGACY = true;

/** Множитель размера блока по силе доли — сильная заметно крупнее (с капом). */
const BEAT_SIZE: Record<BeatType, number> = {
  strong: 1.3, weak: 0.92, off: 0.72, solo: 1.0,
};
/** Старые множители размера (исходный вид) — крупнее, без капа. */
const BEAT_SIZE_LEGACY: Record<BeatType, number> = {
  strong: 1.55, weak: 0.95, off: 0.7, solo: 1.05,
};
/** Потолок размера блока — чтобы не проваливался под дорогу и не загораживал вид. */
const SIZE_MAX = 1.7;
/** Высота центра блока над дорогой (исходно 0.75; новый — нота-хайвей 1.0). */
const BLOCK_Y = LEGACY ? 0.75 : 1.0;
/** Длительность поп-анимации сбора (с). */
const POP_SEC = 0.16;
/** Приоритеты для склейки/прорежения: тон важнее перкуссии, сильное важнее слабого. */
const VOICE_RANK: Record<Voice, number> = { lead: 3, bass: 2, snare: 1, kick: 0 };
const BEAT_RANK: Record<BeatType, number> = { strong: 3, weak: 2, off: 1, solo: 0 };

export interface BlockDef {
  dist: number;
  lane: number; // -1 | 0 | 1 — для цвета
  x: number; // мировой x (ось дороги + полоса); магнит двигает
  y: number;
  vel: number;
  /** MIDI-питч реального события песни — сбор дублирует его (ты «играешь» трек). */
  pitch: number;
  /** Сколько нот склеено: множитель очков (кап 3) и размера. */
  count: number;
  /** Сила доли (размер + пульс-кик). */
  beatType: BeatType;
  /** Голос: тембр сбора + цвет блока. */
  voice: Voice;
  /** Нота, бонус-пикап, золотой джекпот или мистери-«?». */
  kind: 'note' | 'magnet' | 'gold' | 'mystery';
  /** Для пикапа (kind='magnet'): какая способность. */
  power?: 'magnet' | 'shield' | 'double' | 'triple' | 'ram';
  collected: boolean;
  missed: boolean;
  /** Хореографированный паттерн полосы: волна/стена/зигзаг/лесенка/маятник/дабл. */
  pattern?: 'sweep' | 'wall' | 'zigzag' | 'stairs' | 'pendulum' | 'double';
  /** Блок-кульминация музыкального дропа (тост «ДРОП!» + всплеск). */
  drop?: boolean;
  /** Широкий «МЕГА»-блок (Фаза B): крупный, широкая зона сбора, ×2 очки. */
  wide?: boolean;
  /** DDA: блок убран прорежением — не собирается и не считается промахом. */
  dropped?: boolean;
  /** Решение о прорежении принято (один раз, при входе в ближнюю зону). */
  decided?: boolean;
  /** Время музыки в момент сбора — для поп-анимации разлёта. */
  collectAt?: number;
}

/** Казино-слой: есть ли в заезде золотой джекпот и сколько мистери-блоков. */
export interface BlockExtras {
  gold: boolean;
  mystery: number;
}

const MAGNET_COLOR = new THREE.Color('#ffd24d');
const GOLD_COLOR = new THREE.Color('#fff3a0');
const MYSTERY_COLOR = new THREE.Color('#ffffff');
/** Цвет пикапа по способности. */
export const POWER_COLOR: Record<string, THREE.Color> = {
  magnet: new THREE.Color('#ffd24d'),
  shield: new THREE.Color('#44d6ff'),
  double: new THREE.Color('#ff66cc'),
  triple: new THREE.Color('#ff3b6b'), // ×3 френзи — горячий малиновый
  ram: new THREE.Color('#ff7a1a'), // таран — оранжевый плуг
};
export const POWER_CSS: Record<string, string> = {
  magnet: '#ffd24d', shield: '#44d6ff', double: '#ff66cc',
  triple: '#ff3b6b', ram: '#ff7a1a',
};
const MAGNET_EVERY = [25, 40]; // раз в столько секунд трека, случайно

export class Blocks {
  readonly mesh: THREE.InstancedMesh;
  private defs: BlockDef[] = [];
  private cursor = 0; // первый блок, который ещё может быть собран/пропущен
  private dummy = new THREE.Object3D();
  private colorTmp = new THREE.Color();
  private density = 1; // DDA: 1 — все блоки, <1 — часть прорежена
  private frame = 0; // счётчик кадров — для half-rate анимации дальних блоков
  private popping: { i: number; t0: number }[] = []; // блоки в поп-анимации сбора
  // ворота акцентов (МЕГА-ноты) — отдельные статичные меши, проезжаешь насквозь
  readonly gates = new THREE.Group();
  private gateOf: (THREE.Object3D | null)[] = []; // index ноты → её ворота (или null)
  private gatePopping: { mesh: THREE.Object3D; t0: number }[] = [];

  /** Невидимая адаптивная сложность: доля оставляемых нот (0.55–1). */
  setDensity(d: number) { this.density = Math.max(0.55, Math.min(1, d)); }

  constructor(
    song: Song, level: Level, diff: Difficulty = 'norm',
    extras: BlockExtras = { gold: false, mystery: 0 },
  ) {
    const cfg = DIFF_CFG[diff];

    // ритм-секция (kick/snare/бас), привязанная к сетке долей и расклассифицированная
    // по силе доли. Блоки садятся СЮДА — игра в ритм. Мелодия-соло берётся только
    // в безритмовых тактах (барабанов нет, держится одна нота).
    const grid = buildBeatGrid(song);
    const { slots, activityPerBar, bars } = extractRhythm(song, grid);
    const allowed = new Set(cfg.beats);

    // СЛОЙ МУЗЫКАЛЬНОЙ СТРУКТУРЫ: энергия по тактам (онсеты ритм-секции) → видим,
    // где затишье, где разгон, где дроп. На этом строится драматургия паттернов
    // (тихо — мягкая волна, громко — драйв) и привязка наград к пику (дофамин:
    // build-up видно издалека, кульминация приносит джекпот).
    const barSec = grid.barTicks * grid.secPerTick;
    // сглаживание ±1 такт, нормировка по максимуму → energy[bar] ∈ [0,1]
    const energy = new Array<number>(bars).fill(0);
    {
      let maxE = 1;
      for (let i = 0; i < bars; i++) {
        const e = (activityPerBar[i - 1] ?? 0) * 0.5 + activityPerBar[i]
          + (activityPerBar[i + 1] ?? 0) * 0.5;
        energy[i] = e;
        if (e > maxE) maxE = e;
      }
      for (let i = 0; i < bars; i++) energy[i] /= maxE;
    }
    const energyAtTime = (t: number) =>
      energy[Math.max(0, Math.min(bars - 1, Math.floor(t / barSec)))] ?? 0;
    // ДЕТЕКТ ДРОПОВ: такт громкий (energy>0.6) И заметно громче предыдущего окна
    // (build-up→взрыв). Берём время начала такта-дропа; пик музыки = пик игры.
    const dropTimes: number[] = [];
    for (let i = 2; i < bars; i++) {
      const prevAvg = (energy[i - 1] + energy[i - 2]) * 0.5;
      if (energy[i] > 0.6 && energy[i] - prevAvg > 0.22) {
        const t = i * barSec;
        if (t > 6 && t < level.durationSec - 6
            && (dropTimes.length === 0 || t - dropTimes[dropTimes.length - 1] > 6))
          dropTimes.push(t);
      }
    }

    // блоки ведёт РИТМ-секция (kick/snare/bass на доли). Lead-соло — лишь РЕДКИЙ
    // акцент-цвет на сильную долю, опущенный в средний регистр (раньше lead-соло
    // доминировало → высокие «пищащие» блоки не в ритм). Берём ведущую роль по
    // приоритету lead>counter>arp только как источник этих редких акцентов.
    const MELODY_ROLES = ['lead', 'counter', 'arp'] as const;
    const leadRole = MELODY_ROLES.find((r) => song.tracks.some((t) => t.role === r));
    const leadNotes = leadRole
      ? song.tracks.find((t) => t.role === leadRole)?.notes ?? [] : [];

    // единый поток событий. Каждое — реальное событие трека; сбор продублирует
    // именно его → «я играю музыку» (модель Beat Saber/Audiosurf).
    interface Pick { t: number; pitch: number; vel: number; beat: BeatType; voice: Voice; }
    const beatOf = (cls: ReturnType<typeof classifyTick>): BeatType =>
      cls === 'strong' ? 'strong' : cls === 'weak' ? 'weak' : 'off';
    const picks: Pick[] = [];
    // 1) ПУЛЬС: бас/бочка/снейр ТОЛЬКО на сильную/слабую долю. Офф-биты и хэт-
    //    поток отбрасываем — иначе бас 16-х затапливает мелодию (был баг lead33/bass182).
    for (const s of slots) {
      if (s.cls !== 'strong' && s.cls !== 'weak') continue; // без офф-флуда баса
      const realHit = s.sources.has('kick') || s.sources.has('bass')
        || s.sources.has('snare') || s.sources.has('perc');
      if (!realHit) continue;
      const beat = beatOf(s.cls);
      if (!allowed.has(beat)) continue;
      const voice: Voice = s.sources.has('bass') ? 'bass'
        : s.sources.has('snare') ? 'snare' : 'kick';
      picks.push({ t: s.tick * grid.secPerTick, pitch: s.pitch, vel: s.vel, beat, voice });
    }
    // 2) LEAD-АКЦЕНТ: РЕДКО — нота только на сильную долю, с кулдауном ~3.5с, и
    //    опущенная в средний регистр (не пищит). Капля мелодии-цвета поверх ритма.
    let lastLeadT = -100;
    for (const n of leadNotes) {
      if (classifyTick(n.start, grid) !== 'strong') continue; // только сильная доля
      const t = n.start * grid.secPerTick;
      if (t - lastLeadT < 3.5) continue; // редко
      lastLeadT = t;
      let lp = n.pitch; while (lp > 74) lp -= 12; // в средний регистр (анти-«писк»)
      picks.push({ t, pitch: lp, vel: n.vel, beat: 'strong', voice: 'lead' });
    }
    picks.sort((a, b) => a.t - b.t);

    // склейка одновременных → блок-аккорд. Голос/питч — самого «тонального»
    // события (lead>bass>snare>kick), сила доли — самого сильного. Кик-пульс на
    // сильной доле добавит sfx по beatType.
    interface Cluster { t: number; pitch: number; vel: number; count: number; beat: BeatType; voice: Voice; }
    const clusters: Cluster[] = [];
    for (const p of picks) {
      const t = p.t;
      if (t < 5 || t >= level.durationSec - 1.2) continue; // разгон и короткий хвост у финиша
      const last = clusters[clusters.length - 1];
      if (last && t - last.t <= CLUSTER_SEC) {
        last.vel = Math.max(last.vel, p.vel);
        last.count++;
        if (BEAT_RANK[p.beat] > BEAT_RANK[last.beat]) last.beat = p.beat;
        if (VOICE_RANK[p.voice] > VOICE_RANK[last.voice]) { last.voice = p.voice; last.pitch = p.pitch; }
      } else {
        clusters.push({ t, pitch: p.pitch, vel: p.vel, count: 1, beat: p.beat, voice: p.voice });
      }
    }

    // кап плотности: не чаще maxPerSec. Поток ведёт РИТМ; редкий lead-акцент имеет
    // умеренный бонус (переживает конфликт, но не доминирует), затем сила доли.
    const weight = (c: Cluster) =>
      (c.voice === 'lead' ? 20 : 0) + BEAT_RANK[c.beat] * 4 + VOICE_RANK[c.voice];
    const minGap = 1 / cfg.maxPerSec;
    const stream: Cluster[] = [];
    for (const c of clusters) {
      const last = stream[stream.length - 1];
      if (last && c.t - last.t < minGap) {
        // важнейший побеждает, но ОСТАЁТСЯ на раннем (на-бите) времени — иначе блок
        // уезжает на время победителя (до minGap позже) → ощущение отставания ритма.
        if (weight(c) > weight(last)) stream[stream.length - 1] = { ...c, t: last.t };
        continue;
      }
      stream.push(c);
    }

    // полосы: обычно мелодический контур, но периодически — ХОРЕОГРАФИЯ. Словарь
    // паттернов (читаемые фигуры → мозг предсказывает → дофамин), выбор по ЭНЕРГИИ
    // секции: тихо — мягкая волна/лесенка, громко — драйв (зигзаг/стена/дабл).
    // Перед дропом — РАЗГОН (маятник), НА дропе — короткий burst + кульминация-блок.
    // Достижимость (±1 за шаг, не чаще laneShiftGap) сохраняется во всех паттернах.
    type PatName = 'sweep' | 'wall' | 'zigzag' | 'stairs' | 'pendulum' | 'double';
    const pickFrom = (a: PatName[]): PatName => a[Math.floor(Math.random() * a.length)];
    let lane = 0;
    let lastShiftT = -10;
    let lastFarT = -100;
    let prevPitch: number | null = null;
    let patUntil = -1; // конец активного паттерна
    let patName: PatName = 'sweep';
    let patDir = 1; // направление (свип/лесенка/маятник)
    let patPivot = 1; // край для зигзага (бьём 0↔patPivot)
    let holdCount = 0; // дабл-тап: сколько блоков держим полосу
    let nextPatT = 10 + Math.random() * 16; // когда можно начать следующий паттерн
    let dropIdx = 0; // курсор по временам дропов
    let markDrop = false; // пометить ближайший блок как кульминацию дропа
    for (const c of stream) {
      const dPitch = prevPitch === null ? 0 : c.pitch - prevPitch;
      prevPitch = c.pitch;
      const canShift = c.t - lastShiftT >= cfg.laneShiftGap;

      // ДРОП: пересекли время дропа → этот блок = кульминация (wide+drop), запускаем
      // короткий burst (стена/зигзаг). Срабатывает независимо от текущего паттерна.
      if (dropIdx < dropTimes.length && c.t >= dropTimes[dropIdx]) {
        markDrop = true;
        patName = Math.random() < 0.5 ? 'wall' : 'zigzag';
        patUntil = c.t + 1.8 + Math.random() * 0.8; // короткий взрыв ~1.8–2.6с
        patPivot = lane >= 1 ? 1 : lane <= -1 ? -1 : (Math.random() < 0.5 ? -1 : 1);
        nextPatT = patUntil + 6 + Math.random() * 8;
        dropIdx++;
      }

      // старт паттерна — по кулдауну, не у самого конца трека
      if (patUntil < 0 && c.t >= nextPatT && c.t < level.durationSec - 8) {
        const nextDrop = dropTimes[dropIdx];
        if (nextDrop !== undefined && nextDrop > c.t && nextDrop - c.t <= 7) {
          // РАЗГОН к дропу: маятник во всю ширину до самого дропа
          patName = 'pendulum';
          patUntil = nextDrop;
          patDir = lane >= 1 ? -1 : lane <= -1 ? 1 : (Math.random() < 0.5 ? -1 : 1);
        } else {
          const e = energyAtTime(c.t);
          patName = e < 0.35 ? pickFrom(['sweep', 'stairs'])
            : e < 0.7 ? pickFrom(['zigzag', 'sweep', 'double'])
            : pickFrom(['zigzag', 'wall', 'double']);
          // стена короче (плотный ритм → иначе 20-30 блоков в один ряд); прочие 4–7с
          patUntil = c.t + (patName === 'wall' ? 1.6 + Math.random() * 1.2 : 4 + Math.random() * 3);
          patDir = patName === 'stairs'
            ? (dPitch > 0 ? 1 : dPitch < 0 ? -1 : (Math.random() < 0.5 ? -1 : 1))
            : lane >= 1 ? -1 : lane <= -1 ? 1 : (Math.random() < 0.5 ? -1 : 1);
          patPivot = lane >= 1 ? 1 : lane <= -1 ? -1 : (Math.random() < 0.5 ? -1 : 1);
          nextPatT = patUntil + 6 + Math.random() * 8; // пауза 6–14с
        }
        holdCount = 0;
      }
      if (c.t >= patUntil && patUntil > 0) patUntil = -1; // паттерн кончился

      if (patUntil > 0) holdCount++;
      if (canShift && patUntil > 0) {
        if (patName === 'sweep' || patName === 'pendulum') {
          // ВОЛНА/МАЯТНИК: ведём полосу край-в-край, разворот у краёв
          if (lane >= 1) patDir = -1; else if (lane <= -1) patDir = 1;
          if (lane + patDir >= -1 && lane + patDir <= 1) { lane += patDir; lastShiftT = c.t; }
        } else if (patName === 'zigzag') {
          // ЗИГЗАГ: упругий отскок центр↔край (узкая амплитуда, бодро)
          const target = lane === 0 ? patPivot : 0;
          const dir = Math.sign(target - lane);
          if (dir !== 0) { lane += dir; lastShiftT = c.t; }
        } else if (patName === 'stairs') {
          // ЛЕСЕНКА: монотонный забег в одну сторону; у края — паттерн завершён
          if (lane + patDir >= -1 && lane + patDir <= 1) { lane += patDir; lastShiftT = c.t; }
          else patUntil = -1; // дошли до края — «забег» прочитан, выходим
        } else if (patName === 'double') {
          // ДАБЛ-ТАП: держим полосу 2 блока, затем шаг (мелодия/дрейф к центру)
          if (holdCount >= 2) {
            let dir = dPitch > 1 ? 1 : dPitch < -1 ? -1 : 0;
            if (dir === 0) dir = lane > 0 ? -1 : lane < 0 ? 1 : (Math.random() < 0.5 ? -1 : 1);
            if (lane + dir >= -1 && lane + dir <= 1) { lane += dir; lastShiftT = c.t; holdCount = 0; }
          }
        }
        // 'wall' — держим полосу (серия в одной линии), ничего не двигаем
      } else if (canShift) {
        // мелодический контур (вне паттерна)
        let dir = 0;
        if (dPitch > 1) dir = 1;
        else if (dPitch < -1) dir = -1;
        if (cfg.farJump && Math.abs(dPitch) > 12 && Math.abs(lane) === 1 &&
            Math.sign(dir) === -Math.sign(lane) && c.t - lastFarT > FAR_JUMP_COOLDOWN &&
            c.t - lastShiftT >= cfg.laneShiftGap * 1.5) {
          lane = -lane;
          lastFarT = c.t;
          lastShiftT = c.t;
        } else if (dir !== 0 && lane + dir >= -1 && lane + dir <= 1) {
          lane += dir;
          lastShiftT = c.t;
        } else if (dir === 0 && c.t - lastShiftT >= cfg.laneShiftGap * 1.6) {
          // ритм-блоки ПЛОСКИЕ по питчу → без этого копился ряд 20-30 в одну линию.
          // Мягкое блуждание ±1: от края к центру, из центра — в случайный край.
          lane += lane !== 0 ? (lane > 0 ? -1 : 1) : (Math.random() < 0.5 ? -1 : 1);
          lastShiftT = c.t;
        }
      }
      const isDrop = markDrop; markDrop = false;
      const dist = level.distAt(c.t);
      this.defs.push({
        dist,
        lane,
        x: level.curveAt(dist) + lane * LANE_X,
        y: level.heightAt(dist) + BLOCK_Y,
        vel: c.vel,
        pitch: Math.round(c.pitch),
        count: Math.min(c.count, 3),
        beatType: c.beat,
        voice: c.voice,
        kind: 'note',
        pattern: patUntil > 0 ? patName : undefined,
        // МЕГА-блок: кульминация дропа ИЛИ редкий случайный акцент на сильную долю
        wide: isDrop || (patUntil < 0 && c.beat === 'strong' && Math.random() < 0.07),
        drop: isDrop || undefined,
        collected: false,
        missed: false,
      });
    }

    // dev-сводка: разбивка по голосу/доле — видно баланс мелодии и ритма
    if (import.meta.env?.DEV) {
      const v: Record<string, number> = { lead: 0, bass: 0, kick: 0, snare: 0 };
      const b: Record<string, number> = { strong: 0, weak: 0, off: 0, solo: 0 };
      const p: Record<string, number> = { sweep: 0, wall: 0, zigzag: 0, stairs: 0, pendulum: 0, double: 0 };
      let drops = 0;
      for (const d of this.defs) {
        v[d.voice]++; b[d.beatType]++;
        if (d.pattern) p[d.pattern]++;
        if (d.drop) drops++;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[blocks] ${diff} «${song.title}» ${song.bpm}bpm: ${this.defs.length} блоков · ` +
        `голос[lead ${v.lead} bass ${v.bass} kick ${v.kick} snare ${v.snare}] · ` +
        `доля[strong ${b.strong} weak ${b.weak} off ${b.off}] · ` +
        `паттерн[волна ${p.sweep} стена ${p.wall} зигзаг ${p.zigzag} лесенка ${p.stairs} ` +
        `маятник ${p.pendulum} дабл ${p.double}] · дропов ${dropTimes.length} (кульминаций ${drops})`,
      );
    }

    // бонусы-пикапы: на пути потока, раз в 25–40 секунд; способность случайна
    {
      const POWERS: NonNullable<BlockDef['power']>[] = ['magnet', 'shield', 'double', 'triple', 'ram'];
      let nextAt = 12 + Math.random() * 10;
      for (let i = 1; i < stream.length; i++) {
        if (stream[i].t < nextAt) continue;
        nextAt = stream[i].t + MAGNET_EVERY[0] + Math.random() * (MAGNET_EVERY[1] - MAGNET_EVERY[0]);
        const base = this.defs[i]; // та же полоса, что у ближайшего блока
        if (!base) break;
        const dist = base.dist + 5;
        this.defs.push({
          dist,
          lane: base.lane,
          x: level.curveAt(dist) + base.lane * LANE_X,
          y: level.heightAt(dist) + BLOCK_Y,
          vel: 100,
          pitch: 60,
          count: 1,
          beatType: 'solo',
          voice: 'lead',
          kind: 'magnet',
          power: POWERS[Math.floor(Math.random() * POWERS.length)],
          collected: false,
          missed: false,
        });
      }
    }

    // казино-слой: спец-блоки. ЯКОРИМ к дропам — джекпот падает сразу за
    // кульминацией музыкального пика (resolution reward, дофамин). Дропов нет —
    // прежняя раскладка по доле трека.
    {
      const dropDefs = this.defs.filter((d) => d.drop);
      const placeAt = (kind: 'gold' | 'mystery', base: BlockDef | undefined, ahead: number) => {
        if (!base) return;
        const dist = base.dist + ahead;
        this.defs.push({
          dist,
          lane: base.lane,
          x: level.curveAt(dist) + base.lane * LANE_X,
          y: level.heightAt(dist) + BLOCK_Y,
          vel: 127,
          pitch: 60,
          count: 1,
          beatType: 'solo',
          voice: 'lead',
          kind,
          collected: false,
          missed: false,
        });
      };
      const placeFrac = (kind: 'gold' | 'mystery', frac: number) =>
        placeAt(kind, this.defs[Math.floor(this.defs.length * Math.min(0.92, frac))], 4);
      // джекпот — сразу за случайным дропом (там пик), иначе где-то в середине
      if (extras.gold) {
        if (dropDefs.length) placeAt('gold', dropDefs[Math.floor(Math.random() * dropDefs.length)], 6);
        else placeFrac('gold', 0.35 + Math.random() * 0.4);
      }
      // мистери — по дропам (разносим), иначе равномерно по треку
      for (let m = 0; m < extras.mystery; m++) {
        if (dropDefs.length) placeAt('mystery', dropDefs[m % dropDefs.length], 5 + (m % 2) * 3);
        else placeFrac('mystery', (0.2 + 0.6 * (m / Math.max(1, extras.mystery - 1) || 0))
          + Math.random() * 0.12);
      }
      this.defs.sort((a, b) => a.dist - b.dist);
    }

    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    if (LEGACY) {
      // ИСХОДНЫЙ вид: желейный additive-куб, цвет голоса через instanceColor.
      geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
      mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false,
        toneMapped: false,
      });
    } else {
      // Маркер ноты — призрачный неон-ШАР (читается с любого угла). Затенение через
      // vertex-color от нормали (верх светлее) × instanceColor (голос). toneMapped:false
      // → неон ловится блумом. Своя копия геометрии на сегмент.
      geo = new THREE.SphereGeometry(0.5, 16, 12);
      const norm = geo.getAttribute('normal');
      const cnt = geo.getAttribute('position').count;
      const vc = new Float32Array(cnt * 3);
      for (let k = 0; k < cnt; k++) {
        const s = 0.7 + 0.3 * Math.max(0, norm.getY(k)); // верхние грани светлее
        vc[k * 3] = vc[k * 3 + 1] = vc[k * 3 + 2] = s;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      // Освещаемый материал: реагирует на свет фар/фонарей. Собственное неон-свечение
      // по голосу — emissive = vColor (vertexShade × instanceColor) инъекцией в шейдер;
      // освещение (фары/лампы) добавляет яркость СВЕРХУ. Призрачная полупрозрачность.
      const sm = new THREE.MeshStandardMaterial({
        vertexColors: true, metalness: 0.0, roughness: 1.0, toneMapped: false,
        transparent: true, opacity: 0.3, depthWrite: true,
      });
      // диффуз-отклик СЛАБЫЙ (×0.25) — фары лишь слегка подсвечивают, «свет проходит
      // сквозь как сквозь туман», не слепят; видимый цвет несёт собственное свечение.
      sm.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= 0.25;')
          .replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += vColor.rgb * 0.55;');
      };
      mat = sm;
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, this.defs.length);
    this.mesh.frustumCulled = false;
    this.defs.forEach((b, i) => {
      this.dummy.position.set(b.x, b.y, -b.dist);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i,
        b.kind === 'magnet' ? (POWER_COLOR[b.power ?? 'magnet'] ?? MAGNET_COLOR)
        : b.kind === 'gold' ? GOLD_COLOR
        : b.kind === 'mystery' ? MYSTERY_COLOR
        : VOICE_COLORS[b.voice]); // нота: цвет = голос (инструмент сбора)
    });
    // МЕГА-ноты → ворота-арки (внешняя модель): прячем их инстанс-самоцвет и
    // ставим статичную арку, проезжаешь насквозь. Если модель не загрузилась —
    // остаются обычным (крупным) самоцветом.
    const archTpl = getArchTemplate();
    if (archTpl && !LEGACY) {
      this.defs.forEach((b, i) => {
        if (!b.wide) return;
        const gate = archTpl.clone(true);
        gate.scale.setScalar(getArchScale());
        gate.position.set(b.x, b.y - BLOCK_Y + getArchBaseY(), -b.dist);
        const col = VOICE_COLORS[b.voice];
        gate.traverse((o) => {
          if (o instanceof THREE.Mesh)
            o.material = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
        });
        this.gates.add(gate);
        this.gateOf[i] = gate;
        // спрятать инстанс-самоцвет этой ноты — рисуем воротами
        this.dummy.position.set(b.x, b.y, -b.dist);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get total() {
    return this.defs.length;
  }

  /** Полосы, занятые блоками в окрестности дистанции — для честных преград. */
  lanesNear(dist: number, span: number): Set<number> {
    const lanes = new Set<number>();
    // defs отсортированы по dist — бинарный поиск левой границы
    let lo = 0, hi = this.defs.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.defs[mid].dist < dist - span) lo = mid;
      else hi = mid;
    }
    for (let i = lo; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > dist + span) break;
      if (b.dist >= dist - span) lanes.add(b.lane);
    }
    return lanes;
  }

  /** Базовый размер блока (без пульса), с потолком SIZE_MAX — анти-провал/загораживание. */
  private sizeOf(b: BlockDef): number {
    if (LEGACY) {
      // исходные размеры (крупнее, без капа)
      if (b.kind === 'magnet') return 1.15;
      if (b.kind === 'gold' || b.kind === 'mystery') return 1.5;
      // ОБЫЧНЫЙ размер для всех нот: убраны множители МЕГА/паттерн/аккорд — больше
      // нет огромных кубов. wide/pattern/count живут в очках/зоне сбора, не в размере.
      return (0.7 + (b.vel / 127) * 0.6) * BEAT_SIZE_LEGACY[b.beatType];
    }
    if (b.kind === 'magnet') return 1.1;
    if (b.kind === 'gold') return 1.35;
    if (b.kind === 'mystery') return 1.3;
    // ОБЫЧНЫЙ размер для всех нот: убраны множители МЕГА/паттерн/аккорд.
    return Math.min(SIZE_MAX, (0.62 + (b.vel / 127) * 0.4) * BEAT_SIZE[b.beatType]);
  }

  /**
   * Магнит, сбор, пропуск и анимация ближних блоков.
   * onCollect(блок) — очки/эффекты; onMiss() — для счётчика промахов.
   */
  update(
    carDist: number, carWorldX: number, time: number, dt: number, fever: boolean,
    magnet: boolean, throb: number,
    onCollect: (b: BlockDef, perfect: boolean) => void, onMiss: () => void,
  ) {
    // DDA-прорежение: при входе нот-блока в ближнюю зону (~50 м) решаем
    // оставить или убрать — детерминированно по индексу, чтобы не дёргалось.
    // Прорежение чинит трудный момент незаметно (принцип EndeavorRx).
    if (this.density < 1) {
      for (let i = this.cursor; i < this.defs.length; i++) {
        const b = this.defs[i];
        if (b.dist > carDist + 50) break;
        if (b.decided || b.kind !== 'note' || b.collected || b.missed) continue;
        b.decided = true;
        // хэш индекса в [0,1): убираем долю (1-density) самых «лишних»
        const h = ((i * 2654435761) >>> 0) / 4294967296;
        if (h > this.density) {
          b.dropped = true;
          this.dummy.position.set(b.x, b.y, -b.dist);
          this.dummy.scale.setScalar(0.0001);
          this.dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this.dummy.matrix);
        }
      }
    }

    // пропущенные позади (бонус-магнит и прореженные промахом не считаются)
    while (this.cursor < this.defs.length && this.defs[this.cursor].dist < carDist - 2.5) {
      const b = this.defs[this.cursor];
      if (!b.collected && !b.missed) {
        b.missed = true;
        if (b.kind === 'note' && !b.dropped) onMiss();
      }
      this.cursor++;
    }

    // магнит активен только пока действует подобранный бонус
    if (magnet) {
      for (let i = this.cursor; i < this.defs.length; i++) {
        const b = this.defs[i];
        if (b.dist > carDist + 9) break;
        if (b.collected || b.missed) continue;
        if (b.dist > carDist - 1 && Math.abs(b.x - carWorldX) < 4.5)
          b.x += (carWorldX - b.x) * Math.min(1, dt * 10);
      }
    }

    // окно сбора
    for (let i = this.cursor; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > carDist + 2.0) break;
      const lat = b.wide ? COLLECT_LATERAL * 1.7 : COLLECT_LATERAL; // МЕГА — шире зона
      if (!b.collected && !b.missed && !b.dropped &&
          b.dist <= carDist + 1.2 && Math.abs(b.x - carWorldX) < lat) {
        b.collected = true;
        // grading: попадание в центр полосы блока = PERFECT (непрерывная
        // ось мастерства — всегда видно, что оптимизировать)
        const perfect = Math.abs(b.x - carWorldX) < lat * 0.42;
        onCollect(b, perfect);
        if (LEGACY) {
          // исходное поведение: мгновенно спрятать (уходит под землю)
          this.dummy.position.set(b.x, b.y, -b.dist);
          this.dummy.scale.setScalar(0.0001);
          this.dummy.updateMatrix();
          this.mesh.setMatrixAt(i, this.dummy.matrix);
        } else {
          // новый: поп-анимация. МЕГА = ворота (выстрел арки), иначе шар.
          b.collectAt = time;
          const gate = this.gateOf[i];
          if (gate) this.gatePopping.push({ mesh: gate, t0: time });
          else this.popping.push({ i, t0: time });
        }
      }
    }

    // вращение и пульс ближних видимых. throb (0..1) — канал blockThrob дирижёра:
    // в холодном затишье ≈0 → блоки не дышат «сами», только крутятся.
    const pulseAmp = (fever ? 0.16 : 0.07) * throb;
    let colorDirty = false;
    this.frame++;
    const odd = this.frame & 1;
    for (let i = this.cursor; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > carDist + 170) break;
      if (b.collected || b.dropped) continue;
      if (this.gateOf[i]) continue; // МЕГА-нота рисуется воротами, не инстансом
      // дальние (>70 м) обновляем через кадр (≈30 Гц): на таком расстоянии
      // вращение на глаз неотличимо, а матричной работы вдвое меньше. Чётность
      // по индексу — половина дальних обновляется каждый кадр, без мерцания
      if (b.dist > carDist + 70 && ((i ^ odd) & 1)) continue;
      this.dummy.position.set(b.x, b.y, -b.dist);
      if (b.kind === 'magnet') {
        // бонус крутится заметно быстрее
        this.dummy.rotation.set(time * 2.2, time * 3.1, 0);
        this.dummy.scale.setScalar(this.sizeOf(b) + Math.sin(time * 6) * 0.1);
      } else if (b.kind === 'gold') {
        // джекпот: бешено крутится, видно издалека
        this.dummy.rotation.set(time * 3, time * 4.2, time * 1.5);
        this.dummy.scale.setScalar(this.sizeOf(b) + Math.sin(time * 8) * 0.15);
      } else if (b.kind === 'mystery') {
        // «?»: дышит и переливается — что внутри, узнаешь на подборе
        this.dummy.rotation.set(time * 1.3, time * 2.5, time * 1.2);
        this.dummy.scale.setScalar(this.sizeOf(b) + Math.sin(time * 4.5) * 0.18);
        this.colorTmp.setHSL((time * 0.9 + i * 0.13) % 1, 0.95, 0.7);
        this.mesh.setColorAt(i, this.colorTmp);
        colorDirty = true;
      } else {
        // legacy — хаотичный кувырок по 3 осям (как было); новый — спокойный Y-спин
        if (LEGACY) this.dummy.rotation.set(0, time * 1.4 + i * 0.7, time * 0.9 + i);
        else this.dummy.rotation.set(0, time * 0.8 + i * 0.5, 0);
        const pulse = 1 + Math.sin(time * 5 + i) * pulseAmp;
        this.dummy.scale.setScalar(this.sizeOf(b) * pulse);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    // поп-анимация сбора: блок «выстреливает» вверх и схлопывается + закрутка —
    // осмысленный удар по ноте вместо проваливания под асфальт.
    for (let p = this.popping.length - 1; p >= 0; p--) {
      const { i, t0 } = this.popping[p];
      const b = this.defs[i];
      const k = (time - t0) / POP_SEC;
      if (k >= 1) {
        this.dummy.position.set(b.x, b.y, -b.dist);
        this.dummy.scale.setScalar(0.0001); // спрятан
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        this.popping.splice(p, 1);
        continue;
      }
      const pop = k < 0.35 ? 1 + (k / 0.35) * 0.5 : 1.5 * Math.max(0, 1 - (k - 0.35) / 0.65);
      this.dummy.position.set(b.x, b.y + k * 0.6, -b.dist); // лёгкий подброс вверх
      this.dummy.rotation.set(k * 3, k * 5, k * 2); // закрутка при разлёте
      this.dummy.scale.setScalar(this.sizeOf(b) * pop);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }

    // поп ворот: арка «раскрывается» наружу и исчезает (проехал сквозь — сыграл)
    for (let p = this.gatePopping.length - 1; p >= 0; p--) {
      const { mesh, t0 } = this.gatePopping[p];
      const k = (time - t0) / POP_SEC;
      if (k >= 1) { mesh.visible = false; this.gatePopping.splice(p, 1); continue; }
      mesh.scale.setScalar(getArchScale() * (1 + k * 0.4));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    // ворота: материалы наши (создали при клоне), геометрия общая с шаблоном — не трогаем
    this.gates.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).dispose();
    });
  }
}
