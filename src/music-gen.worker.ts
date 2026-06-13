// Генерация трека в фоне: процедурный синтез MIDI тяжёлый (десятки мс ×
// несколько попыток отбора), на главном потоке это даёт фриз на старте каждого
// заезда. Здесь — вне UI-потока. midi-gen/core — чистые вычисления, Song —
// структурно-клонируемый объект (включая BigInt seed), безопасно гоняется через
// postMessage. См. newSong в music.ts (синхронный fallback).
import { generate, type GenreId, type Song } from 'midi-gen/core';

const post = postMessage as (msg: unknown) => void;

function songDurationSec(song: Song): number {
  return (song.durationTicks / song.ppq) * (60 / song.bpm);
}

/** Отбор по длительности: первый трек ≤63 с, иначе самый короткий из попыток. */
function pick(genre: GenreId): Song {
  let best: Song | null = null;
  for (let i = 0; i < 4; i++) { // было 8 — половины хватает, вдвое меньше CPU
    const s = generate({ genre });
    const sec = songDurationSec(s);
    if (sec <= 63) return s;
    if (!best || sec < songDurationSec(best)) best = s;
  }
  return best!;
}

addEventListener('message', (e: MessageEvent) => {
  const { id, genre } = e.data as { id: number; genre: GenreId };
  post({ id, song: pick(genre) });
});
