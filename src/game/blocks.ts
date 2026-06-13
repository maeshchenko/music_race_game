import * as THREE from 'three';
import type { Song } from 'midi-gen/core';
import type { Level } from './level';
import { buildBeatGrid, extractRhythm, classifyTick } from './rhythm';

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
/** Множитель размера блока по силе доли — сильная заметно крупнее. */
const BEAT_SIZE: Record<BeatType, number> = {
  strong: 1.55, weak: 0.95, off: 0.7, solo: 1.05,
};
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
  /** Хореографированный паттерн (Фаза B): свип-змейка или стена. */
  pattern?: 'sweep' | 'wall';
  /** Широкий «МЕГА»-блок (Фаза B): крупный, широкая зона сбора, ×2 очки. */
  wide?: boolean;
  /** DDA: блок убран прорежением — не собирается и не считается промахом. */
  dropped?: boolean;
  /** Решение о прорежении принято (один раз, при входе в ближнюю зону). */
  decided?: boolean;
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
    const { slots } = extractRhythm(song, grid);
    const allowed = new Set(cfg.beats);

    // мелодия = ВЕДУЩИЙ голос игры (её ты «играешь»). Берём ноты одной ведущей
    // роли по приоритету lead>counter>arp (lead — настоящий мотив; arp — текстура,
    // в крайнем случае). Берём ЩЕДРО на ВСЕХ позициях (вкл. синкопы) — мелодия
    // и есть «busy»-слой. Бас/барабаны = только ПУЛЬС на сильную/слабую долю.
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
    // 2) МЕЛОДИЯ: тональные блоки на их позиции — всегда (это «песня, что играешь»)
    for (const n of leadNotes) {
      picks.push({
        t: n.start * grid.secPerTick, pitch: n.pitch, vel: n.vel,
        beat: beatOf(classifyTick(n.start, grid)), voice: 'lead',
      });
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

    // кап плотности: не чаще maxPerSec. В конфликте держим важнейшее — мелодию
    // (большой бонус lead), затем силу доли. Поток = «играбельная песня» в бит.
    const weight = (c: Cluster) =>
      (c.voice === 'lead' ? 100 : 0) + BEAT_RANK[c.beat] * 4 + VOICE_RANK[c.voice];
    const minGap = 1 / cfg.maxPerSec;
    const stream: Cluster[] = [];
    for (const c of clusters) {
      const last = stream[stream.length - 1];
      if (last && c.t - last.t < minGap) {
        if (weight(c) > weight(last)) stream[stream.length - 1] = c;
        continue;
      }
      stream.push(c);
    }

    // полосы: обычно мелодический контур, но периодически — ХОРЕОГРАФИЯ
    // (вариативность Фазы B): свип (вис край-в-край) или стена (серия в одной
    // полосе). Достижимость (±1 за шаг, не чаще laneShiftGap) сохраняется.
    let lane = 0;
    let lastShiftT = -10;
    let lastFarT = -100;
    let prevPitch: number | null = null;
    let patUntil = -1; // конец активного паттерна
    let patKind = 0; // 0 — свип, 1 — стена (hold)
    let patDir = 1; // направление свипа
    let nextPatT = 10 + Math.random() * 16; // когда можно начать следующий паттерн
    for (const c of stream) {
      const dPitch = prevPitch === null ? 0 : c.pitch - prevPitch;
      prevPitch = c.pitch;
      const canShift = c.t - lastShiftT >= cfg.laneShiftGap;
      // старт паттерна — по кулдауну, не у самого конца трека
      if (patUntil < 0 && c.t >= nextPatT && c.t < level.durationSec - 8) {
        patUntil = c.t + 4 + Math.random() * 3; // длиннее (4–7с) → явно читается
        patKind = Math.random() < 0.55 ? 0 : 1;
        patDir = lane >= 1 ? -1 : lane <= -1 ? 1 : (Math.random() < 0.5 ? -1 : 1);
        nextPatT = patUntil + 6 + Math.random() * 8; // чаще (пауза 6–14с)
      }
      if (c.t >= patUntil && patUntil > 0) patUntil = -1; // паттерн кончился
      if (canShift) {
        if (patUntil > 0 && patKind === 0) {
          // СВИП: ведём полосу край-в-край, разворот у краёв
          if (lane >= 1) patDir = -1; else if (lane <= -1) patDir = 1;
          if (lane + patDir >= -1 && lane + patDir <= 1) { lane += patDir; lastShiftT = c.t; }
        } else if (patUntil > 0 && patKind === 1) {
          // СТЕНА: держим полосу (серия блоков в одной линии) — ничего не двигаем
        } else {
          // мелодический контур
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
          } else if (dir === 0 && lane !== 0 && c.t - lastShiftT >= cfg.laneShiftGap * 2.2) {
            lane += lane > 0 ? -1 : 1; // без мелодического движения — дрейф к центру
            lastShiftT = c.t;
          }
        }
      }
      const dist = level.distAt(c.t);
      this.defs.push({
        dist,
        lane,
        x: level.curveAt(dist) + lane * LANE_X,
        y: level.heightAt(dist) + 0.75,
        vel: c.vel,
        pitch: Math.round(c.pitch),
        count: Math.min(c.count, 3),
        beatType: c.beat,
        voice: c.voice,
        kind: 'note',
        pattern: patUntil > 0 ? (patKind === 0 ? 'sweep' : 'wall') : undefined,
        // МЕГА-блок: иногда на сильную долю вне паттерна — крупный акцент
        wide: patUntil < 0 && c.beat === 'strong' && Math.random() < 0.1,
        collected: false,
        missed: false,
      });
    }

    // dev-сводка: разбивка по голосу/доле — видно баланс мелодии и ритма
    if (import.meta.env?.DEV) {
      const v: Record<string, number> = { lead: 0, bass: 0, kick: 0, snare: 0 };
      const b: Record<string, number> = { strong: 0, weak: 0, off: 0, solo: 0 };
      for (const d of this.defs) { v[d.voice]++; b[d.beatType]++; }
      // eslint-disable-next-line no-console
      console.log(
        `[blocks] ${diff} «${song.title}» ${song.bpm}bpm: ${this.defs.length} блоков · ` +
        `голос[lead ${v.lead} bass ${v.bass} kick ${v.kick} snare ${v.snare}] · ` +
        `доля[strong ${b.strong} weak ${b.weak} off ${b.off}]`,
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
          y: level.heightAt(dist) + 0.85,
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

    // казино-слой: спец-блоки рядом с потоком, в средней части трека
    {
      const placeSpecial = (kind: 'gold' | 'mystery', frac: number) => {
        const base = this.defs[Math.floor(this.defs.length * Math.min(0.92, frac))];
        if (!base) return;
        const dist = base.dist + 4;
        this.defs.push({
          dist,
          lane: base.lane,
          x: level.curveAt(dist) + base.lane * LANE_X,
          y: level.heightAt(dist) + 0.9,
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
      // джекпот — неожиданно, где-то в середине
      if (extras.gold) placeSpecial('gold', 0.35 + Math.random() * 0.4);
      // мистери — равномерно по треку, со случайным сдвигом
      for (let m = 0; m < extras.mystery; m++)
        placeSpecial('mystery', (0.2 + 0.6 * (m / Math.max(1, extras.mystery - 1) || 0))
          + Math.random() * 0.12);
      this.defs.sort((a, b) => a.dist - b.dist);
    }

    const geo = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, // мимо ACES — неон остаётся кислотным
    });
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

  /**
   * Магнит, сбор, пропуск и анимация ближних блоков.
   * onCollect(блок) — очки/эффекты; onMiss() — для счётчика промахов.
   */
  update(
    carDist: number, carWorldX: number, time: number, dt: number, fever: boolean,
    magnet: boolean,
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
        this.dummy.position.set(b.x, b.y, -b.dist);
        this.dummy.scale.setScalar(0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
      }
    }

    // вращение и пульс ближних видимых
    const pulseAmp = fever ? 0.16 : 0.07;
    let colorDirty = false;
    this.frame++;
    const odd = this.frame & 1;
    for (let i = this.cursor; i < this.defs.length; i++) {
      const b = this.defs[i];
      if (b.dist > carDist + 170) break;
      if (b.collected || b.dropped) continue;
      // дальние (>70 м) обновляем через кадр (≈30 Гц): на таком расстоянии
      // вращение на глаз неотличимо, а матричной работы вдвое меньше. Чётность
      // по индексу — половина дальних обновляется каждый кадр, без мерцания
      if (b.dist > carDist + 70 && ((i ^ odd) & 1)) continue;
      this.dummy.position.set(b.x, b.y, -b.dist);
      if (b.kind === 'magnet') {
        // бонус крутится заметно быстрее и крупнее
        this.dummy.rotation.set(time * 2.2, time * 3.1, 0);
        this.dummy.scale.setScalar(1.15 + Math.sin(time * 6) * 0.12);
      } else if (b.kind === 'gold') {
        // джекпот: крупный, бешено крутится, видно издалека
        this.dummy.rotation.set(time * 3, time * 4.2, time * 1.5);
        this.dummy.scale.setScalar(1.5 + Math.sin(time * 8) * 0.18);
      } else if (b.kind === 'mystery') {
        // «?»: крупный, дышит и переливается — что внутри, узнаешь на подборе
        this.dummy.rotation.set(time * 1.3, time * 2.5, time * 1.2);
        this.dummy.scale.setScalar(1.5 + Math.sin(time * 4.5) * 0.25);
        this.colorTmp.setHSL((time * 0.9 + i * 0.13) % 1, 0.95, 0.7);
        this.mesh.setColorAt(i, this.colorTmp);
        colorDirty = true;
      } else {
        this.dummy.rotation.set(0, time * 1.4 + i * 0.7, time * 0.9 + i);
        const pulse = 1 + Math.sin(time * 5 + i) * pulseAmp;
        const size = (0.7 + (b.vel / 127) * 0.6) * (1 + 0.18 * (b.count - 1))
          * BEAT_SIZE[b.beatType] // сильная доля крупнее
          * (b.pattern ? 1.4 : 1) // блоки паттерна крупнее — фигура читается явно
          * (b.wide ? 1.9 : 1); // МЕГА-блок — крупный акцент
        this.dummy.scale.setScalar(size * pulse);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colorDirty && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
