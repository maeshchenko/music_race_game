import * as Tone from 'tone';
import type { Song } from 'midi-gen/core';
import { buildEnsemble } from 'midi-gen/audio';

/**
 * Дирижёр бесконечного сета. ОДИН Tone.Transport, который не
 * останавливается между треками — секунды растут непрерывно часами. Каждый
 * трек («стем») подвешивается на свой сдвиг по транспорту: его ноты звучат с
 * startOffset, релизы и реверб-хвосты прошлого трека дозванивают поверх стыка
 * (так миди-движок и держит бесшовные лупы). Машинная позиция игры тянется за
 * глобальной transport.seconds — клок ни разу не обнуляется.
 *
 * Слой = роль трека открывается комбо-тиром (как в music.ts/createStemPlayer):
 * база (drums+bass+lead) всегда, chords/counter c x8, arp/fx c x16.
 */

type Role = Song['tracks'][number]['role'];
const ROLE_TIER: Record<Role, number> = {
  drums: 0, bass: 0, lead: 0,
  chords: 1, counter: 1,
  arp: 2, fx: 2,
};

/** Один подвешенный трек: свои ноты/ансамбль, снимается без затрагивания транспорта. */
export interface Stem {
  /** Текущий открытый тир слоёв для ЭТОГО трека. */
  setTier(tier: number): void;
  /** Глобальное транспортное время старта (сек) и конца звучания (+хвост). */
  readonly startSec: number;
  readonly endSec: number;
  /** Готов ли ансамбль (reverb-IR сгенерирован). */
  ready(): Promise<void>;
  /** Снять трек: освободить ноды. НЕ трогает общий транспорт. */
  retire(): void;
}

export class Conductor {
  private transport = Tone.getTransport();
  private latCache = 0;
  private latCalls = 0;
  private started = false;
  private stems = new Set<{ parts: Tone.Part[]; autoIds: number[]; ensemble: ReturnType<typeof buildEnsemble> | null }>();

  /** Подвесить трек со сдвигом startOffsetSec по глобальному транспорту. */
  addStem(song: Song, startOffsetSec: number): Stem {
    const secPerTick = 60 / song.bpm / song.ppq;
    const durationSec = song.durationTicks * secPerTick;
    const TAIL = 1.5;
    let tier = 0;
    let ensemble: ReturnType<typeof buildEnsemble> | null = null;
    let parts: Tone.Part[] = [];
    let autoIds: number[] = [];
    const rec: {
      parts: Tone.Part[]; autoIds: number[];
      ensemble: ReturnType<typeof buildEnsemble> | null;
    } = { parts, autoIds, ensemble };
    this.stems.add(rec);

    const build = () => {
      ensemble = buildEnsemble(song);
      rec.ensemble = ensemble;
      parts = song.tracks.map((track, i) => {
        const voice = ensemble!.voices[i];
        const roleTier = ROLE_TIER[track.role] ?? 0;
        const events = track.notes.map((n) => ({
          time: n.start * secPerTick,
          pitch: n.pitch,
          dur: Math.max(0.02, n.dur * secPerTick),
          vel: n.vel / 127,
          slide: n.slide,
        }));
        const part = new Tone.Part((time, ev) => {
          if (roleTier > tier) return; // слой ещё не открыт комбо
          voice.trigger(ev.pitch, time, ev.dur, ev.vel, ev.slide);
        }, events);
        part.start(startOffsetSec); // ноты звучат со сдвига этого трека
        return part;
      });
      rec.parts = parts;
      autoIds = ensemble.automations.map((a) =>
        this.transport.schedule((t) => a.apply(t), startOffsetSec + a.time));
      rec.autoIds = autoIds;
    };
    build();

    return {
      startSec: startOffsetSec,
      endSec: startOffsetSec + durationSec + TAIL,
      setTier: (t) => { tier = t; },
      ready: async () => { await ensemble!.ready; },
      retire: () => {
        for (const id of autoIds) this.transport.clear(id);
        for (const p of parts) p.dispose();
        ensemble?.dispose();
        ensemble = null;
        rec.ensemble = null;
        rec.parts = [];
        this.stems.delete(rec);
      },
    };
  }

  /** Запустить транспорт один раз (после первого Tone.start()). */
  async start() {
    await Tone.start();
    if (this.started) return;
    this.started = true;
    this.transport.loop = false;
    this.transport.start();
  }

  pause() { this.transport.pause(); }
  resume() { this.transport.start(); }
  isPlaying() { return this.transport.state === 'started'; }

  /** Глобальная позиция (сек) с поправкой на latency — клок никогда не сбрасывается. */
  positionSec(): number {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as AudioContext;
    if (raw.state !== 'running') return 0;
    if (this.latCalls++ % 30 === 0) {
      this.latCache = ctx.lookAhead + (raw.outputLatency || raw.baseLatency || 0);
    }
    return Math.max(0, this.transport.seconds - this.latCache);
  }

  dispose() {
    for (const rec of [...this.stems]) {
      for (const id of rec.autoIds) this.transport.clear(id);
      for (const p of rec.parts) p.dispose();
      rec.ensemble?.dispose();
    }
    this.stems.clear();
    this.transport.stop();
    this.transport.position = 0;
    this.transport.cancel();
    this.started = false;
  }
}
