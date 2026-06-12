import { generate, type GenreId, type Song } from 'midi-gen/core';

export type GameGenre = Extract<GenreId, 'grimerun' | 'outrun' | 'eurobeat'>;

export const GENRES: GameGenre[] = ['grimerun', 'outrun', 'eurobeat'];

export function newSong(genre: GameGenre): Song {
  const minutes = 3 + Math.floor(Math.random() * 3); // 3–5 минут
  return generate({ genre, minutes });
}

export function songDurationSec(song: Song): number {
  return (song.durationTicks / song.ppq) * (60 / song.bpm);
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
