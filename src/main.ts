import { type Song } from 'midi-gen/core';
import { createPlayer, type Player } from 'midi-gen/audio';
import { newSong, songDurationSec, formatDuration } from './music';
import { Game } from './game/game';
import { buildLevel } from './game/level';

const app = document.querySelector<HTMLDivElement>('#app')!;
const menu = document.createElement('div');
menu.className = 'menu';
menu.innerHTML = `
  <div class="panel">
    <h1>2107</h1>
    <p class="sub">ритм-гонка · провинция · вечер</p>
    <div class="track-info">
      <div class="track-title" id="title"></div>
      <div class="track-meta" id="meta"></div>
      <div class="track-code" id="code"></div>
    </div>
    <div>
      <button id="gen">НОВЫЙ ТРЕК</button>
      <button id="start">ПОЕХАЛИ</button>
    </div>
    <p class="hint">мышь — руль · C — вид из салона · Esc — выход в меню</p>
  </div>
`;
app.appendChild(menu);

const titleEl = menu.querySelector<HTMLDivElement>('#title')!;
const metaEl = menu.querySelector<HTMLDivElement>('#meta')!;
const codeEl = menu.querySelector<HTMLDivElement>('#code')!;

let song: Song;
let player: Player | null = null;
let game: Game | null = null;

function newTrack() {
  song = newSong('grimerun');
  titleEl.textContent = song.title;
  metaEl.textContent = `grimerun · ${song.bpm} BPM · ${formatDuration(songDurationSec(song))}`;
  codeEl.textContent = song.code;
}

async function startRide() {
  menu.style.display = 'none';
  player = createPlayer(song, { loop: false });
  player.onEnded = backToMenu; // финиш = конец трека (этап 5: экран результатов)
  game = new Game(app, buildLevel(song), player);
  game.start();
  await player.play();
}

function backToMenu() {
  player?.stop();
  player?.dispose();
  player = null;
  game?.dispose();
  game = null;
  menu.style.display = '';
}

menu.querySelector('#gen')!.addEventListener('click', newTrack);
menu.querySelector('#start')!.addEventListener('click', () => void startRide());
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && game) backToMenu();
});

newTrack();
