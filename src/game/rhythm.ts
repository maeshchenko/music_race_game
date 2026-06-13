import type { Song } from 'midi-gen/core';

/**
 * Ритм из символьного MIDI. У нас точные тики/питчи/роли — метрическую позицию
 * (сильная/слабая доля, офф-бит) считаем напрямую, без onset-detection по звуку.
 *
 * Чарт-дизайн ритм-игр: лёгкие уровни — сильные доли (1 и 3 в 4/4), сложнее —
 * +бэкбит (2,4), ещё сложнее — офф-биты и 16-е. Блоки садятся на ритм-секцию
 * (kick/snare/бас); мелодия-соло берётся отдельно там, где ритма нет.
 */

/** Класс доли по метрической позиции. */
export type BeatClass = 'strong' | 'weak' | 'off' | 'sync';

export interface BeatGrid {
  barTicks: number;
  beatTicks: number; // длительность доли (в 4/4 = ppq)
  subTicks: number; // 16-я — шаг квантования
  secPerTick: number;
  beatsPerBar: number;
}

export function buildBeatGrid(song: Song): BeatGrid {
  const barTicks = (song.ppq * 4 * song.timeSig[0]) / song.timeSig[1];
  const beatsPerBar = song.timeSig[0];
  const beatTicks = barTicks / beatsPerBar;
  return {
    barTicks,
    beatTicks,
    subTicks: beatTicks / 4,
    secPerTick: 60 / (song.ppq * song.bpm),
    beatsPerBar,
  };
}

/** Метрический класс тика. SNAP широкий — свинг сдвигает офф-биты. */
export function classifyTick(tick: number, g: BeatGrid): BeatClass {
  const posInBar = ((tick % g.barTicks) + g.barTicks) % g.barTicks;
  const beatIdx = Math.floor(posInBar / g.beatTicks);
  const within = posInBar - beatIdx * g.beatTicks;
  const SNAP = g.beatTicks * 0.18;
  if (within < SNAP || g.beatTicks - within < SNAP) {
    // на доле
    if (beatIdx === 0) return 'strong'; // даунбит
    if (beatIdx === Math.floor(g.beatsPerBar / 2)) return 'strong'; // вторичная сильная (доля 3)
    return 'weak'; // бэкбит (доли 2,4)
  }
  if (Math.abs(within - g.beatTicks / 2) < SNAP) return 'off'; // «и» — 8-й офф-бит
  return 'sync'; // 16-е / синкопа
}

/** Инструмент ударного по GM-номеру (drums-нота несёт номер в pitch). */
function drumKind(pitch: number): 'kick' | 'snare' | 'hat' | 'perc' {
  if (pitch === 35 || pitch === 36) return 'kick';
  if (pitch === 38 || pitch === 40 || pitch === 37) return 'snare';
  if (pitch === 42 || pitch === 44 || pitch === 46) return 'hat';
  return 'perc';
}

/** Слот ритм-сетки: один кандидат-блок. */
export interface RhythmSlot {
  tick: number; // привязан к сетке
  bar: number;
  cls: BeatClass;
  vel: number;
  sources: Set<'kick' | 'snare' | 'hat' | 'perc' | 'bass'>;
  /** Питч для контура полос (бас, иначе ближайшая мелодия, иначе 60). */
  pitch: number;
}

export interface RhythmAnalysis {
  slots: RhythmSlot[]; // отсортированы по tick
  /** Онсетов ритм-секции (drums+bass) в такте — для детекта соло-тактов. */
  activityPerBar: number[];
  bars: number;
}

/**
 * Онсеты ритм-секции (drums+bass), привязанные к 16-й сетке и сгруппированные
 * по слотам. Питч слота берётся из баса (контур), иначе из ближайшей мелодии.
 */
export function extractRhythm(song: Song, g: BeatGrid): RhythmAnalysis {
  const bars = Math.max(1, Math.ceil(song.durationTicks / g.barTicks));
  const activityPerBar = new Array<number>(bars).fill(0);

  // мелодические ноты (для питча слотов без баса) — по приоритету роли
  const MELODY_ROLES = ['lead', 'arp', 'counter', 'chords'] as const;
  const leadRole = MELODY_ROLES.find((r) => song.tracks.some((t) => t.role === r));
  const melody = leadRole
    ? [...(song.tracks.find((t) => t.role === leadRole)?.notes ?? [])].sort((a, b) => a.start - b.start)
    : [];
  const nearestMelodyPitch = (tick: number): number | null => {
    if (!melody.length) return null;
    // линейный поиск ближайшего по start (мелодий немного)
    let best = melody[0], bestD = Math.abs(melody[0].start - tick);
    for (const n of melody) {
      const d = Math.abs(n.start - tick);
      if (d < bestD) { best = n; bestD = d; }
    }
    return best.pitch;
  };

  const snap = (tick: number) => Math.round(tick / g.subTicks) * g.subTicks;
  const byTick = new Map<number, RhythmSlot>();

  for (const tr of song.tracks) {
    const isDrums = tr.role === 'drums';
    const isBass = tr.role === 'bass';
    if (!isDrums && !isBass) continue;
    for (const n of tr.notes) {
      const bar = Math.min(bars - 1, Math.floor(n.start / g.barTicks));
      activityPerBar[bar]++;
      const t = snap(n.start);
      let slot = byTick.get(t);
      if (!slot) {
        slot = {
          tick: t,
          bar: Math.min(bars - 1, Math.floor(t / g.barTicks)),
          cls: classifyTick(t, g),
          vel: 0,
          sources: new Set(),
          pitch: 60,
        };
        byTick.set(t, slot);
      }
      slot.vel = Math.max(slot.vel, n.vel);
      slot.sources.add(isDrums ? drumKind(n.pitch) : 'bass');
      // питч: бас задаёт контур; иначе оставляем для пост-обработки
      if (isBass) slot.pitch = n.pitch;
    }
  }

  // слоты без баса — питч из ближайшей мелодии (для контура полос)
  for (const slot of byTick.values()) {
    if (!slot.sources.has('bass')) {
      const p = nearestMelodyPitch(slot.tick);
      if (p != null) slot.pitch = p;
    }
  }

  const slots = [...byTick.values()].sort((a, b) => a.tick - b.tick);
  return { slots, activityPerBar, bars };
}
