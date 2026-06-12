import * as Tone from 'tone';
import { type Song } from 'midi-gen/core';
import { createPlayer, type Player } from 'midi-gen/audio';

import { IS_MOBILE } from './platform';

// большой аудиобуфер: живой синтез тяжёлый, при потере фокуса macOS режет
// приоритет Chrome — с маленьким буфером звук захлёбывается и не встаёт.
// На телефонах вдобавок половиним частоту дискретизации — DSP в ~2 раза
// дешевле, иначе синтез не успевает и звук с игрой заикаются.
Tone.setContext(new Tone.Context({
  latencyHint: 'playback',
  ...(IS_MOBILE ? { sampleRate: 24000 } : {}),
}));
import { newSong, songDurationSec, formatDuration, GENRES, type GameGenre } from './music';
import { Game } from './game/game';
import { buildLevel } from './game/level';
import type { Difficulty } from './game/blocks';

/**
 * SIMPLE_MENU: единственный экран «Мижган представляет» — случайный outrun,
 * сложность хард. false — старое меню (4 трека, сложность, калибровка).
 */
const SIMPLE_MENU = true;

const DIFF_LABELS: Record<Difficulty, string> = {
  light: 'ЛАЙТ', norm: 'НОРМ', hard: 'ХАРД',
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const menu = document.createElement('div');
menu.className = 'menu';
menu.innerHTML = SIMPLE_MENU
  ? `
  <div class="simple-panel">
    <p class="presents">МИЖГАН ПРЕДСТАВЛЯЕТ ИГРУ</p>
    <div class="title-3d">2107</div>
    <button id="start" class="play-btn">ИГРАТЬ</button>
    <p class="hint">управление — мышью · C — вид из салона · пробел — пауза</p>
  </div>
`
  : `
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
    <p class="hint">мышь — руль · C — вид из салона · пробел — пауза · Esc — меню</p>
  </div>
`;
app.appendChild(menu);

const tracksEl = menu.querySelector<HTMLDivElement>('#tracks');
const diffsEl = menu.querySelector<HTMLDivElement>('#diffs');

let tracks: Song[] = [];
let sel = 0;
let diff: Difficulty = SIMPLE_MENU ? 'hard' : 'norm';
let player: Player | null = null;
let game: Game | null = null;
let results: HTMLDivElement | null = null;
let replayRequested = false; // «ЕЩЁ РАЗ» — не перегенерировать трек
// --- громкость: музыка через мастер, эффекты — смещением в Sfx ----------
const VOL_KEY = 'race2107:vol';
let vol = { music: 55, sfx: 70 };
try { vol = { ...vol, ...JSON.parse(localStorage.getItem(VOL_KEY) ?? '{}') }; } catch { /* дефолт */ }

const dbOf = (v: number) => (v <= 0 ? -80 : -36 + (v / 100) * 36);

function applyVolumes() {
  Tone.getDestination().volume.value = dbOf(vol.music);
  game?.sfx.setOffset(dbOf(vol.sfx) - dbOf(vol.music));
  localStorage.setItem(VOL_KEY, JSON.stringify(vol));
}
applyVolumes();

// калибровка аудио-задержки: блоки раньше/позже звука, шаг 10 мс
let audioOffsetMs = +(localStorage.getItem('race2107:audio-offset') ?? '0');
if (!SIMPLE_MENU) {
  const calVal = menu.querySelector<HTMLSpanElement>('#cal-val')!;
  const renderCal = () => {
    calVal.textContent = `${audioOffsetMs > 0 ? '+' : ''}${audioOffsetMs} мс`;
    localStorage.setItem('race2107:audio-offset', String(audioOffsetMs));
  };
  menu.querySelector('#cal-minus')!.addEventListener('click', () => {
    audioOffsetMs = Math.max(-200, audioOffsetMs - 10);
    renderCal();
  });
  menu.querySelector('#cal-plus')!.addEventListener('click', () => {
    audioOffsetMs = Math.min(200, audioOffsetMs + 10);
    renderCal();
  });
  renderCal();
}

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
  if (!tracksEl) return;
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
  if (!diffsEl) return;
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
  // простой флоу: каждый заезд — свежий случайный outrun
  if (SIMPLE_MENU && !replayRequested) tracks = [newSong('outrun')], sel = 0;
  replayRequested = false;
  const song = tracks[sel];
  player = createPlayer(song, { loop: false });
  game = new Game(app, song, buildLevel(song), player, diff, audioOffsetMs / 1000);
  // результаты — после финишного наката (машина докатилась), не по концу музыки
  game.onFinish = showResults;
  game.start();
  applyVolumes(); // смещение эффектов — на свежесозданный Sfx
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
  results.querySelector('#again')!.addEventListener('click', () => {
    replayRequested = true;
    void startRide();
  });
  results.querySelector('#tomenu')!.addEventListener('click', backToMenu);
}

function backToMenu() {
  teardownRide();
  results?.remove();
  results = null;
  renderTracks();
  menu.style.display = '';
}

menu.querySelector('#regen')?.addEventListener('click', genTracks);
menu.querySelector('#start')!.addEventListener('click', () => void startRide());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // в заезде Esc открывает паузу; из паузы/результатов — в главное меню
    if (results) backToMenu();
    else if (game && game.paused) backToMenu();
    else if (game) pauseGame();
  }
  if (e.code === 'Space' && game) {
    e.preventDefault(); // чтобы пробел не «нажимал» сфокусированную кнопку
    if (game.paused) resumeGame();
    else pauseGame();
  }
});

// --- пауза при потере фокуса -------------------------------------------
// Без фокуса macOS режет приоритет Chrome — живой синтез захлёбывается.
// Пауза останавливает триггеры нот, голоса отзвучивают, после клика чисто.
let pauseOverlay: HTMLDivElement | null = null;

function pauseGame() {
  if (!game || game.paused) return;
  game.paused = true;
  game.releasePointer(); // курсор обратно — двигать ползунки
  Tone.getTransport().pause();
  pauseOverlay = document.createElement('div');
  pauseOverlay.className = 'menu';
  pauseOverlay.innerHTML = `<div class="panel"><h1>ПАУЗА</h1>
    <div class="vol-row"><span>музыка</span>
      <input type="range" id="vol-music" min="0" max="100" value="${vol.music}"></div>
    <div class="vol-row"><span>эффекты</span>
      <input type="range" id="vol-sfx" min="0" max="100" value="${vol.sfx}"></div>
    <p class="sub">клик или пробел — продолжить · Esc — выйти в меню</p></div>`;
  pauseOverlay.addEventListener('click', (e) => {
    // клики по ползункам не снимают паузу
    if ((e.target as HTMLElement).closest('.vol-row')) return;
    resumeGame();
  });
  pauseOverlay.querySelector<HTMLInputElement>('#vol-music')!.addEventListener('input', (e) => {
    vol.music = +(e.target as HTMLInputElement).value;
    applyVolumes();
  });
  pauseOverlay.querySelector<HTMLInputElement>('#vol-sfx')!.addEventListener('input', (e) => {
    vol.sfx = +(e.target as HTMLInputElement).value;
    applyVolumes();
  });
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

if (!SIMPLE_MENU) {
  genTracks();
  renderDiffs();
}

// --- мобильный гейт: полноэкран + ландшафт перед меню --------------------
if (matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window) {
  const gate = document.createElement('div');
  gate.className = 'menu';
  gate.style.zIndex = '100';
  gate.innerHTML = `
    <div class="panel">
      <h1 style="font-size:1.6rem">2107</h1>
      <p class="sub" style="margin-top:1rem">игра идёт в горизонтальном<br>полноэкранном режиме</p>
      <button id="fs-ok">ОК</button>
    </div>`;
  app.appendChild(gate);
  gate.querySelector('#fs-ok')!.addEventListener('click', async () => {
    try {
      await document.documentElement.requestFullscreen();
      // лочится только в полноэкране; на iOS не поддерживается — молча мимо
      await (screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      }).lock?.('landscape');
    } catch { /* best effort */ }
    gate.remove();
  });
}
