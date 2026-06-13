import * as Tone from 'tone';
import { generate, type GenreId, type Song } from 'midi-gen/core';
import { buildEnsemble, type Player } from 'midi-gen/audio';

export type GameGenre = Extract<GenreId, 'grimerun' | 'outrun' | 'eurobeat'>;

export const GENRES: GameGenre[] = ['grimerun', 'outrun', 'eurobeat'];

export function newSong(genre: GameGenre): Song {
  // без minutes — естественная форма жанра (~40–65 с);
  // отбор сидов держит верхнюю границу у минуты
  let best: Song | null = null;
  for (let i = 0; i < 8; i++) {
    const s = generate({ genre });
    const sec = songDurationSec(s);
    if (sec <= 63) return s;
    if (!best || sec < songDurationSec(best)) best = s;
  }
  return best!;
}

export function songDurationSec(song: Song): number {
  return (song.durationTicks / song.ppq) * (60 / song.bpm);
}

// --- stem-плеер: слои музыки открываются комбо-тиром --------------------
//
// Копия createPlayer из midi-gen/audio с одним отличием: дорожки разбиты
// на слои по ролям, и слой звучит только когда комбо дорос до его тира.
// База (тир 0) — drums+bass+lead: трек узнаваем даже без комбо; chords и
// counter — тир 1 (комбо ≥8); arp и fx — тир 2 (комбо ≥16). Срыв комбо
// глушит верхний слой — игрок СЛЫШИТ свой стрик. Ноты просто перестают
// триггериться: конверты дозвучивают, щелчков нет.

export interface StemPlayer extends Player {
  /** Текущий открытый тир слоёв: 0 — база, 2 — всё звучит. */
  setTier(tier: number): void;
}

type Role = Song['tracks'][number]['role'];
const ROLE_TIER: Record<Role, number> = {
  drums: 0, bass: 0, lead: 0,
  chords: 1, counter: 1,
  arp: 2, fx: 2,
};

export function createStemPlayer(song: Song): StemPlayer {
  const secPerTick = 60 / song.bpm / song.ppq;
  const durationSec = song.durationTicks * secPerTick;
  const TAIL = 1.5;
  let ensemble: ReturnType<typeof buildEnsemble> | null = null;
  let parts: Tone.Part[] = [];
  let playing = false;
  let tier = 0;
  let endEventId = -1;
  const transport = Tone.getTransport();

  const scheduleEnd = () => {
    if (endEventId >= 0) transport.clear(endEventId);
    endEventId = -1;
    if (playing) {
      endEventId = transport.scheduleOnce(() => {
        player.stop();
        player.onEnded?.();
      }, durationSec + TAIL);
    }
  };

  const build = () => {
    ensemble = buildEnsemble(song);
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
      part.start(0);
      return part;
    });
    for (const a of ensemble.automations) transport.schedule((t) => a.apply(t), a.time);
  };

  const player: StemPlayer = {
    durationSec,
    setTier: (t) => { tier = t; },
    async play() {
      await Tone.start();
      if (!ensemble) build();
      if (playing) return;
      playing = true;
      transport.loop = false;
      scheduleEnd();
      transport.start();
    },
    stop() {
      if (endEventId >= 0) transport.clear(endEventId);
      endEventId = -1;
      transport.stop();
      transport.position = 0;
      transport.loop = false;
      playing = false;
    },
    isPlaying: () => playing,
    positionSec: () => {
      const ctx = Tone.getContext();
      const raw = ctx.rawContext as AudioContext;
      const latency = ctx.lookAhead + (raw.outputLatency || raw.baseLatency || 0);
      return Math.max(0, Math.min(transport.seconds - latency, durationSec));
    },
    setLoop: () => { /* стем-плеер всегда без лупа — заезд конечен */ },
    looping: () => false,
    dispose() {
      player.stop();
      for (const p of parts) p.dispose();
      parts = [];
      ensemble?.dispose();
      ensemble = null;
      transport.cancel();
    },
  };
  return player;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
