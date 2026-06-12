import { generate, type GenreId, type Song } from 'midi-gen/core';

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

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
