import * as Tone from 'tone';
import { type Song } from 'midi-gen/core';
import { createPlayer, type Player } from 'midi-gen/audio';

// большой аудиобуфер: живой синтез тяжёлый, при потере фокуса macOS режет
// приоритет Chrome — с маленьким буфером звук захлёбывается и не встаёт
Tone.setContext(new Tone.Context({ latencyHint: 'playback' }));
import { newSong, songDurationSec, formatDuration, GENRES, type GameGenre } from './music';
import { Game } from './game/game';
import { buildLevel } from './game/level';
import type { Difficulty } from './game/blocks';

const DIFF_LABELS: Record<Difficulty, string> = {
  light: 'ЛАЙТ', norm: 'НОРМ', hard: 'ХАРД',
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const menu = document.createElement('div');
menu.className = 'menu';
menu.innerHTML = `
  <div class="panel">
    <h1>2107</h1>
    <p class="sub">ритм-гонка · провинция · вечер</p>
    <div class="tracks" id="tracks"></div>
    <div class="diff-row" id="diffs"></div>
    <div class="calib-row">
      <span>синхрон</span>
      <button id="cal-minus" class="small">−</button>
      <span id="cal-val"></span>
      <button id="cal-plus" class="small">+</button>
    </div>
    <div>
      <button id="regen" class="small">ДРУГИЕ ТРЕКИ</button>
      <button id="start">ПОЕХАЛИ</button>
    </div>
    <p class="hint">мышь — руль · C — вид из салона · Esc — выход в меню</p>
  </div>
`;
app.appendChild(menu);

const tracksEl = menu.querySelector<HTMLDivElement>('#tracks')!;
const diffsEl = menu.querySelector<HTMLDivElement>('#diffs')!;

let tracks: Song[] = [];
let sel = 0;
let diff: Difficulty = 'norm';
let player: Player | null = null;
let game: Game | null = null;
let results: HTMLDivElement | null = null;
// калибровка аудио-задержки: блоки раньше/позже звука, шаг 10 мс
let audioOffsetMs = +(localStorage.getItem('race2107:audio-offset') ?? '0');
const calVal = menu.querySelector<HTMLSpanElement>('#cal-val')!;
function renderCal() {
  calVal.textContent = `${audioOffsetMs > 0 ? '+' : ''}${audioOffsetMs} мс`;
  localStorage.setItem('race2107:audio-offset', String(audioOffsetMs));
}
menu.querySelector('#cal-minus')!.addEventListener('click', () => {
  audioOffsetMs = Math.max(-200, audioOffsetMs - 10);
  renderCal();
});
menu.querySelector('#cal-plus')!.addEventListener('click', () => {
  audioOffsetMs = Math.min(200, audioOffsetMs + 10);
  renderCal();
});
renderCal();

// --- рекорды ---------------------------------------------------------------

interface Rec { score: number; combo: number; }
const recKey = (code: string, d: Difficulty) => `race2107:rec:${code}:${d}`;
const loadRec = (code: string, d: Difficulty): Rec | null => {
  try { return JSON.parse(localStorage.getItem(recKey(code, d)) ?? 'null'); }
  catch { return null; }
};
const saveRec = (code: string, d: Difficulty, r: Rec) =>
  localStorage.setItem(recKey(code, d), JSON.stringify(r));

// --- меню ------------------------------------------------------------------

function genTracks() {
  // 4 трека: все три жанра + случайный четвёртый
  const genres: GameGenre[] = [...GENRES, GENRES[Math.floor(Math.random() * GENRES.length)]];
  tracks = genres.map((g) => newSong(g));
  sel = 0;
  renderTracks();
}

function renderTracks() {
  tracksEl.innerHTML = '';
  tracks.forEach((s, i) => {
    const rec = loadRec(s.code, diff);
    const row = document.createElement('div');
    row.className = `track-row${i === sel ? ' sel' : ''}`;
    row.innerHTML = `
      <span class="t-title">${s.title}</span>
      <span class="t-meta">${s.genre} · ${s.bpm} BPM · ${formatDuration(songDurationSec(s))}
        ${rec ? `<span class="t-rec">★ ${rec.score}</span>` : ''}</span>
    `;
    row.addEventListener('click', () => { sel = i; renderTracks(); });
    tracksEl.appendChild(row);
  });
}

function renderDiffs() {
  diffsEl.innerHTML = '';
  (Object.keys(DIFF_LABELS) as Difficulty[]).forEach((d) => {
    const b = document.createElement('button');
    b.className = `small${d === diff ? ' sel' : ''}`;
    b.textContent = DIFF_LABELS[d];
    b.addEventListener('click', () => { diff = d; renderDiffs(); renderTracks(); });
    diffsEl.appendChild(b);
  });
}

// --- игровой цикл ----------------------------------------------------------

async function startRide() {
  results?.remove();
  results = null;
  menu.style.display = 'none';
  const song = tracks[sel];
  player = createPlayer(song, { loop: false });
  player.onEnded = showResults;
  game = new Game(app, song, buildLevel(song), player, diff, audioOffsetMs / 1000);
  game.start();
  await player.play();
  Object.assign(window as never, { __player: player, __game: game }); // отладка
}

function teardownRide() {
  pauseOverlay?.remove();
  pauseOverlay = null;
  player?.stop();
  player?.dispose();
  player = null;
  game?.dispose();
  game = null;
}

function showResults() {
  if (!game) return;
  const song = tracks[sel];
  const { score, maxCombo, collected, blocksTotal } = game;
  const prev = loadRec(song.code, diff);
  const isRecord = !prev || score > prev.score;
  if (isRecord) saveRec(song.code, diff, { score, combo: maxCombo });
  teardownRide();

  results = document.createElement('div');
  results.className = 'menu';
  results.innerHTML = `
    <div class="panel">
      <h1 class="${isRecord ? 'rec-glow' : ''}">${isRecord ? 'РЕКОРД!' : 'ФИНИШ'}</h1>
      <p class="sub">${song.title} · ${song.genre} · ${DIFF_LABELS[diff]}</p>
      <div class="res-score">${score}</div>
      <div class="res-stats">
        комбо x${maxCombo} · блоки ${collected}/${blocksTotal}
        ${prev && !isRecord ? `<br>рекорд ★ ${prev.score}` : ''}
        ${prev && isRecord ? `<br>прошлый ★ ${prev.score}` : ''}
      </div>
      <div>
        <button id="again">ЕЩЁ РАЗ</button>
        <button id="tomenu" class="small">В МЕНЮ</button>
      </div>
    </div>
  `;
  app.appendChild(results);
  results.querySelector('#again')!.addEventListener('click', () => void startRide());
  results.querySelector('#tomenu')!.addEventListener('click', backToMenu);
}

function backToMenu() {
  teardownRide();
  results?.remove();
  results = null;
  renderTracks();
  menu.style.display = '';
}

menu.querySelector('#regen')!.addEventListener('click', genTracks);
menu.querySelector('#start')!.addEventListener('click', () => void startRide());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (game || results)) backToMenu();
});

// --- пауза при потере фокуса -------------------------------------------
// Без фокуса macOS режет приоритет Chrome — живой синтез захлёбывается.
// Пауза останавливает триггеры нот, голоса отзвучивают, после клика чисто.
let pauseOverlay: HTMLDivElement | null = null;

function pauseGame() {
  if (!game || game.paused) return;
  game.paused = true;
  Tone.getTransport().pause();
  pauseOverlay = document.createElement('div');
  pauseOverlay.className = 'menu';
  pauseOverlay.innerHTML = `<div class="panel"><h1>ПАУЗА</h1>
    <p class="sub">клик — продолжить · Esc — в меню</p></div>`;
  pauseOverlay.addEventListener('click', resumeGame);
  app.appendChild(pauseOverlay);
}

function resumeGame() {
  if (!game || !game.paused) return;
  pauseOverlay?.remove();
  pauseOverlay = null;
  game.paused = false;
  Tone.getTransport().start();
  game.grabPointer();
}

addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

genTracks();
renderDiffs();
