import * as Tone from 'tone';
import { type Song } from 'midi-gen/core';
import { type Player } from 'midi-gen/audio';

import { IS_MOBILE } from './platform';

// большой аудиобуфер: живой синтез тяжёлый, при потере фокуса macOS режет
// приоритет Chrome — с маленьким буфером звук захлёбывается и не встаёт.
// На телефонах вдобавок половиним частоту дискретизации — DSP в ~2 раза
// дешевле, иначе синтез не успевает и звук с игрой заикаются.
Tone.setContext(new Tone.Context({
  latencyHint: 'playback',
  ...(IS_MOBILE ? { sampleRate: 24000 } : {}),
}));
import {
  newSong, songDurationSec, formatDuration, createStemPlayer, GENRES, type GameGenre,
} from './music';
import { Game } from './game/game';
import { buildLevel } from './game/level';
import { pickTheme } from './game/world';
import { GarageView } from './garage-view';
import type { Difficulty } from './game/blocks';
import {
  meta, applyRun, openCapsule, buySkin, equipSkin, skinCount, SKINS, RARITY,
  type RunStats,
} from './meta';

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
    <div class="menu-meta">
      <button id="garage" class="small">🔧 ГАРАЖ <span id="cap-badge" class="cap-badge"></span></button>
      <span id="menu-bal" class="menu-bal"></span>
    </div>
    <p class="hint">мышь — руль · F — полный экран · C — салон · 0 — погода · пробел — пауза</p>
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
let nextSong: Song | null = null; // следующий трек: генерится в фоне во время заезда
let countdownTimer = 0;

const randomGenre = (): GameGenre => GENRES[Math.floor(Math.random() * GENRES.length)];

/** Генерация следующего трека заранее — переход между заездами без паузы. */
function pregenNext() {
  const idle: (f: () => void) => void =
    'requestIdleCallback' in window
      ? (f) => requestIdleCallback(f)
      : (f) => void setTimeout(f, 1200);
  idle(() => { if (!nextSong) nextSong = newSong(randomGenre()); });
}
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

// глобальный рекорд: треки каждый заезд новые, по song.code сравнивать не с чем —
// «погоня за рекордом» работает только против общего лучшего счёта
const BEST_KEY = 'race2107:best';
const loadBest = (): Rec | null => {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? 'null'); }
  catch { return null; }
};
const saveBest = (r: Rec) => localStorage.setItem(BEST_KEY, JSON.stringify(r));

// --- казино-слой: валюта-ноты, pity джекпота, «удачный заезд» --------------

let goldDrought = 0; // заездов подряд без джекпота — на 3-м гарантия (pity)
let runsUntilLucky = 2 + Math.floor(Math.random() * 3); // первый lucky — рано, на крючок
let luckyRun = false;
let wheelTimer = 0;

/** Колесо фортуны: множитель нот за заезд. Решается заранее, анимация — декор. */
function rollWheel(): number {
  const r = Math.random();
  return r < 0.5 ? 1 : r < 0.8 ? 1.5 : r < 0.95 ? 2 : 3;
}

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
  clearResults();
  stopMenuSnow();
  menu.style.display = 'none';
  // простой флоу: каждый заезд — свежий случайный трек (жанр тоже случайный),
  // следующий уже готов из pregenNext — без паузы между заездами
  if (SIMPLE_MENU && !replayRequested) {
    tracks = [nextSong ?? newSong(randomGenre())];
    nextSong = null;
    sel = 0;
  }
  replayRequested = false;
  const song = tracks[sel];
  // казино-слой заезда: lucky по счётчику, джекпот с pity, 1–2 мистери
  luckyRun = --runsUntilLucky <= 0;
  if (luckyRun) runsUntilLucky = 4 + Math.floor(Math.random() * 3);
  const gold = luckyRun || goldDrought >= 2 || Math.random() < 0.45;
  goldDrought = gold ? 0 : goldDrought + 1;
  const mystery = luckyRun ? 3 : 2;
  player = createStemPlayer(song);
  const theme = pickTheme(); // новизна: палитра+погода каждый заезд
  game = new Game(app, song, buildLevel(song), player, diff, audioOffsetMs / 1000,
    { gold, mystery, lucky: luckyRun, best: loadBest()?.score ?? 0,
      carColor: meta.skinColor, theme });
  // результаты — после финишного наката (машина докатилась), не по концу музыки
  game.onFinish = showResults;
  game.start();
  applyVolumes(); // смещение эффектов — на свежесозданный Sfx
  await player.play();
  pregenNext();
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

/**
 * Оверлей результатов поверх сцены (машина докатилась, мир живой) +
 * автопереход на следующий трек. Меню между заездами не появляется:
 * продолжение — дефолт, выход — усилие (Esc).
 */
function showResults() {
  if (!game) return;
  const song = tracks[sel];
  const { score, maxCombo, collected, blocksTotal, bonusNotes } = game;
  const prev = loadRec(song.code, diff);
  if (!prev || score > prev.score) saveRec(song.code, diff, { score, combo: maxCombo });
  const best = loadBest();
  const isBest = !best || score > best.score;
  if (isBest) saveBest({ score, combo: maxCombo });
  game.releasePointer(); // курсор обратно — кликнуть кнопку оверлея
  if (isBest && best) game.celebrate(); // золотой салют у машины

  // ноты: блоки + бонусы, lucky ×1.5, колесо решено заранее (анимация — декор)
  const baseNotes = Math.round((collected + bonusNotes) * (luckyRun ? 1.5 : 1));
  const wheelMult = rollWheel();
  const earned = Math.round(baseNotes * wheelMult);

  // мета: начислить ноты+XP, проверить миссии, выдать капсулы за уровни
  const rs: RunStats = {
    blocks: collected, maxCombo, magnets: game.magnetsGot, mystery: game.mysteryGot,
    gold: game.goldGot, noCrashSec: Math.round(game.noCrashSec), score,
  };
  const reward = applyRun(rs, baseNotes, wheelMult);

  // дельта до рекорда: близость, не провал — главный крючок «ещё раз»
  const delta = !best ? ''
    : isBest ? `<div class="res-delta res-delta-up">рекорд побит на ${score - best.score}!</div>`
    : `<div class="res-delta">до рекорда не хватило ${best.score - score}</div>`;

  // три крючка: XP-полоса, миссии (одна 2/3 держит в памяти), до анлока скина
  const xpl = meta.xpInLevel();
  const xpPct = Math.min(100, (xpl.have / xpl.need) * 100);
  const levelUpHtml = reward.levelUp.levels > 0
    ? `<div class="res-levelup">🎁 УРОВЕНЬ ${meta.level}! +${reward.levelUp.capsules} капсул</div>`
    : '';
  const missionsHtml = meta.missions.map((m) => {
    const just = reward.missions.find((r) => r.mission.text === m.text && r.justDone);
    return `<div class="res-mission${just ? ' just-done' : ''}">
      ${m.done || just ? '✅' : '◻️'} ${m.text}
      <span class="m-prog">${Math.min(m.progress, m.goal)}/${m.goal}</span></div>`;
  }).join('');
  const setHtml = reward.setCompleted
    ? `<div class="res-set">🏅 СЕТ МИССИЙ! постоянный множитель ×${(1 + meta.setBonus).toFixed(1)}</div>`
    : '';
  const unl = reward.nextUnlock;
  const unlockHtml = unl
    ? `<div class="res-unlock">до «${unl.name}»: ${Math.min(unl.have, unl.price)}/${unl.price} ♪
        <div class="unlock-bar"><div style="width:${Math.min(100, unl.have / unl.price * 100)}%"></div></div></div>`
    : '';

  let left = 11;
  results = document.createElement('div');
  results.className = 'results-overlay';
  results.innerHTML = `
    <div class="res-title ${isBest ? 'rec-glow' : ''}">${isBest ? 'РЕКОРД!' : 'ФИНИШ'}</div>
    <div class="res-score">${score}</div>
    ${delta}
    <div class="res-stats">комбо x${maxCombo} · блоки ${collected}/${blocksTotal}
      ${game.perfects > 0 ? ` · ✨${game.perfects} PERFECT` : ''} · ${song.genre}
      ${luckyRun ? ' · 🔥 ×1.5' : ''}</div>
    <div class="res-slot">
      <span class="slot-label">♪ ${baseNotes}</span>
      <span class="slot-window"><span class="slot-reel" id="reel"></span></span>
      <span class="slot-total" id="wtotal"></span>
    </div>
    <div class="res-xp">УР.${meta.level}
      <span class="xp-bar"><span class="xp-fill" id="xpfill" style="width:0%"></span></span>
      ${xpl.have}/${xpl.need}</div>
    ${levelUpHtml}
    <div class="res-missions">${missionsHtml}</div>
    ${setHtml}
    ${unlockHtml}
    <div class="res-next">${meta.sessionRuns}-й заезд · следующий через <span id="cnt">${left}</span></div>
    <div><button id="res-replay" class="small">ЕЩЁ РАЗ (R)</button>
      ${meta.capsules > 0 ? `<button id="res-garage" class="small">🎁 КАПСУЛ: ${meta.capsules}</button>` : ''}</div>
    <div class="res-hint">клик или пробел — сразу дальше · Esc — меню</div>
  `;
  app.appendChild(results);
  // XP-полоса заполняется анимацией (goal-gradient — близость цели видна)
  requestAnimationFrame(() => {
    const xf = results?.querySelector<HTMLElement>('#xpfill');
    if (xf) xf.style.width = `${xpPct}%`;
  });
  results.querySelector('#res-garage')?.addEventListener('click', (e) => {
    e.stopPropagation();
    clearResults();
    teardownRide();
    openGarage();
  });

  // слот-машина: барабан прокручивается в окошке, замедляется,
  // садится на выпавший множитель; исход решён заранее — анимация декор
  const slotBox = results.querySelector<HTMLElement>('.res-slot')!;
  const reelEl = results.querySelector<HTMLSpanElement>('#reel')!;
  const wtotal = results.querySelector<HTMLSpanElement>('#wtotal')!;
  const POOL = [1, 2, 1.5, 3, 1, 1.5, 2, 1];
  const cells: number[] = [];
  for (let i = 0; i < 15; i++) cells.push(POOL[i % POOL.length]);
  cells.push(wheelMult); // последняя ячейка — выпавшее
  reelEl.innerHTML = cells.map((v) => `<div class="slot-cell">×${v}</div>`).join('');
  const cellH = 38; // высота .slot-cell, px
  let idx = 0;
  const spinStep = () => {
    if (!results) return;
    idx++;
    const interval = 55 + Math.pow(idx, 1.7) * 5; // разгон → плавный дожим
    reelEl.style.transitionDuration = `${Math.min(interval, 320)}ms`;
    reelEl.style.transform = `translateY(${-idx * cellH}px)`;
    game?.sfx.tick();
    if (idx < cells.length - 1) {
      wheelTimer = window.setTimeout(spinStep, interval);
    } else {
      // приземлились
      wheelTimer = window.setTimeout(() => {
        if (!results) return;
        slotBox.classList.add(wheelMult >= 2 ? 'slot-win' : 'slot-done');
        wtotal.textContent = `= ${earned} · всего ♪ ${meta.notes}`;
        if (wheelMult >= 2) game?.sfx.jackpot();
      }, 150);
    }
  };
  wheelTimer = window.setTimeout(spinStep, 350);
  const cnt = results.querySelector<HTMLSpanElement>('#cnt')!;
  results.querySelector('#res-replay')!.addEventListener('click', (e) => {
    e.stopPropagation();
    replay();
  });
  results.addEventListener('click', () => void startNext());
  countdownTimer = window.setInterval(() => {
    if (document.hidden || game?.paused) return; // фоновая вкладка не листает треки
    left--;
    if (left <= 0) void startNext();
    else cnt.textContent = String(left);
  }, 1000);
}

function clearResults() {
  clearInterval(countdownTimer);
  clearTimeout(wheelTimer);
  results?.remove();
  results = null;
}

async function startNext() {
  if (!results) return; // защита от двойного срабатывания (клик + пробел)
  clearResults();
  teardownRide();
  await startRide();
}

/** Мгновенный рестарт текущего трека — из заезда или с результатов. */
function replay() {
  if (!game && !results) return;
  replayRequested = true;
  clearResults();
  teardownRide();
  void startRide();
}

function backToMenu() {
  teardownRide();
  clearResults();
  closeGarage();
  renderTracks();
  refreshMenuMeta();
  menu.style.display = '';
  startMenuSnow();
}

// --- шапка меню: баланс, уровень, бейдж капсул ----------------------------

function refreshMenuMeta() {
  // первые 2 заезда — чистый главный экран; гараж/ноты/уровень с 3-го раунда
  const metaRow = menu.querySelector<HTMLDivElement>('.menu-meta');
  if (metaRow) metaRow.style.display = meta.totalRuns >= 2 ? '' : 'none';
  const bal = menu.querySelector<HTMLSpanElement>('#menu-bal');
  if (bal) bal.textContent = `♪ ${meta.notes} · УР.${meta.level}`;
  const badge = menu.querySelector<HTMLSpanElement>('#cap-badge');
  if (badge) badge.textContent = meta.capsules > 0 ? String(meta.capsules) : '';
  if (badge) badge.style.display = meta.capsules > 0 ? '' : 'none';
}

// --- гараж: скины за ноты + вскрытие капсул --------------------------------

let garage: HTMLDivElement | null = null;
let garageView: GarageView | null = null;

function garageStageSize(): [number, number] {
  const w = Math.min(innerWidth * 0.82, 640);
  return [w, Math.round(w * 0.46)];
}

function openGarage() {
  stopMenuSnow();
  garage?.remove();
  garage = document.createElement('div');
  garage.className = 'menu garage-screen';
  // оболочка строится раз; 3D-витрина живёт всё время, не пересоздаётся
  garage.innerHTML = `
    <div class="panel garage-panel">
      <h1>ГАРАЖ</h1>
      <div class="garage-stage"></div>
      <p class="sub" id="garage-stats"></p>
      <div id="garage-cap"></div>
      <div class="skins-grid" id="skins-grid"></div>
      <button id="garage-back" class="small">НАЗАД</button>
    </div>`;
  app.appendChild(garage);

  const [gw, gh] = garageStageSize();
  garageView = new GarageView(gw, gh, meta.skinColor);
  garage.querySelector('.garage-stage')!.appendChild(garageView.canvas);

  garage.querySelector('#garage-back')!.addEventListener('click', () => {
    closeGarage();
    refreshMenuMeta();
    menu.style.display = '';
    startMenuSnow();
  });
  renderGarage();
}

function closeGarage() {
  garageView?.dispose();
  garageView = null;
  garage?.remove();
  garage = null;
}

/** Обновляет только сетку скинов, статы и кнопку капсул (не трогает 3D). */
function renderGarage() {
  if (!garage) return;
  const stats = garage.querySelector<HTMLElement>('#garage-stats')!;
  stats.textContent = `♪ ${meta.notes} · уровень ${meta.level} · заездов ${meta.totalRuns}`
    + ` · блоков ${meta.totalBlocks} · лучшее комбо x${meta.bestCombo}`;

  const capWrap = garage.querySelector<HTMLElement>('#garage-cap')!;
  capWrap.innerHTML = meta.capsules > 0
    ? `<button id="open-cap" class="play-btn cap-btn">🎁 ВСКРЫТЬ КАПСУЛУ (${meta.capsules})</button>`
    : '';
  capWrap.querySelector('#open-cap')?.addEventListener('click', runCapsule);

  const grid = garage.querySelector<HTMLElement>('#skins-grid')!;
  grid.innerHTML = SKINS.map((s) => {
    const owned = meta.owned.includes(s.id);
    const equipped = meta.skin === s.id;
    const canBuy = !owned && meta.notes >= s.price;
    const rc = RARITY[s.rarity].css;
    const cnt = skinCount(s.id);
    return `<div class="skin-card${equipped ? ' equipped' : ''}${owned ? ' owned' : ''}"
        data-id="${s.id}" style="--rar:${rc}">
      ${cnt > 1 ? `<span class="skin-count">x${cnt}</span>` : ''}
      <div class="skin-swatch" style="background:#${s.color.toString(16).padStart(6, '0')}"></div>
      <div class="skin-rarity" style="color:${rc}">${RARITY[s.rarity].label}</div>
      <div class="skin-name">${s.name}</div>
      <div class="skin-act">${
        equipped ? '✓ НА МАШИНЕ'
        : owned ? 'НАДЕТЬ'
        : canBuy ? `КУПИТЬ ♪${s.price}`
        : `♪${s.price}`
      }</div>
    </div>`;
  }).join('');
  grid.querySelectorAll<HTMLElement>('.skin-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.dataset.id!;
      if (meta.owned.includes(id)) equipSkin(id);
      else if (!buySkin(id)) return; // не хватило нот — ничего
      garageView?.setColor(meta.skinColor); // цвет применяется сразу
      renderGarage();
    });
  });
}

/** Гача-церемония: тряска → вспышка цветом редкости → новый скин / дубль+ноты. */
function runCapsule() {
  const res = openCapsule();
  if (!res) return;
  const rar = RARITY[res.skin.rarity];
  const hex = `#${res.skin.color.toString(16).padStart(6, '0')}`;
  const fx = document.createElement('div');
  fx.className = 'capsule-fx';
  fx.style.setProperty('--rar', rar.css);
  fx.innerHTML = `<div class="capsule-box">🎁</div>`;
  app.appendChild(fx);
  if (game) game.sfx.tick(); // лёгкий щелчок старта
  setTimeout(() => fx.querySelector('.capsule-box')!.classList.add('burst'), 700);
  setTimeout(() => {
    // легенда/эпик звенят джекпот-арпеджио — крупная награда слышна
    if (game && (res.skin.rarity === 'legendary' || res.skin.rarity === 'epic')) game.sfx.jackpot();
    const inner = res.isNew
      ? `<div class="cap-rarity" style="color:${rar.css}">${rar.label}</div>
         <div class="cap-skin-name" style="color:${hex}">${res.skin.name}</div>
         <div class="cap-tag">НОВЫЙ СКИН!</div>`
      : `<div class="cap-rarity" style="color:${rar.css}">${rar.label} · x${res.count}</div>
         <div class="cap-skin-name" style="color:${hex}">${res.skin.name}</div>
         <div class="cap-tag cap-dupe">ДУБЛЬ x${res.count} → ♪ +${res.notes}</div>`;
    fx.innerHTML = `<div class="capsule-result" style="border-color:${rar.css}">
      <div class="cap-swatch" style="background:${hex}"></div>${inner}</div>`;
    fx.addEventListener('click', () => { fx.remove(); renderGarage(); });
    setTimeout(() => { fx.remove(); renderGarage(); }, 2400);
  }, 1000);
}

menu.querySelector('#regen')?.addEventListener('click', genTracks);
menu.querySelector('#start')!.addEventListener('click', () => void startRide());
menu.querySelector('#garage')?.addEventListener('click', () => {
  menu.style.display = 'none';
  openGarage();
});
refreshMenuMeta();
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // в заезде Esc открывает паузу; из паузы/результатов — в главное меню
    if (results) backToMenu();
    else if (game && game.paused) backToMenu();
    else if (game) pauseGame();
  }
  if (e.code === 'KeyR') replay(); // мгновенный рестарт — без меню и подтверждений
  if (e.code === 'Space') {
    if (results) {
      e.preventDefault();
      void startNext(); // пробел на результатах — сразу следующий трек
      return;
    }
    if (game) {
      e.preventDefault(); // чтобы пробел не «нажимал» сфокусированную кнопку
      if (game.paused) resumeGame();
      else pauseGame();
    }
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

// --- снег в меню: лёгкий канвас, крутится только пока меню видно ----------

const snowCanvas = document.createElement('canvas');
snowCanvas.className = 'menu-snow';
menu.insertBefore(snowCanvas, menu.firstChild);
const sctx = snowCanvas.getContext('2d')!;
let flakes: { x: number; y: number; r: number; sp: number; ph: number }[] = [];
let snowRaf = 0;

function initFlakes() {
  snowCanvas.width = innerWidth;
  snowCanvas.height = innerHeight;
  const n = Math.round((innerWidth * innerHeight) / 22000); // плотность по площади
  flakes = Array.from({ length: n }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    r: 0.8 + Math.random() * 2.2,
    sp: 0.25 + Math.random() * 0.9,
    ph: Math.random() * Math.PI * 2,
  }));
}

function snowFrame() {
  snowRaf = requestAnimationFrame(snowFrame);
  const w = snowCanvas.width, h = snowCanvas.height;
  sctx.clearRect(0, 0, w, h);
  sctx.fillStyle = 'rgba(216, 222, 232, 0.8)';
  for (const f of flakes) {
    f.y += f.sp;
    f.x += Math.sin(f.ph + f.y * 0.012) * 0.35;
    if (f.y > h + 4) { f.y = -4; f.x = Math.random() * w; }
    sctx.beginPath();
    sctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    sctx.fill();
  }
}

function startMenuSnow() {
  if (snowRaf) return;
  initFlakes();
  snowFrame();
}
function stopMenuSnow() {
  cancelAnimationFrame(snowRaf);
  snowRaf = 0;
  sctx.clearRect(0, 0, snowCanvas.width, snowCanvas.height);
}
addEventListener('resize', () => { if (snowRaf) initFlakes(); });
startMenuSnow();

// --- полноэкранный режим: PLAY включает, F переключает -------------------

const isFs = () => !!document.fullscreenElement;
async function enterFs() {
  if (isFs()) return;
  try { await document.documentElement.requestFullscreen(); } catch { /* заблокировано — мимо */ }
}
async function toggleFs() {
  try {
    if (isFs()) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { /* мимо */ }
}

/** Короткий тост внизу — подсказка про полный экран. */
let fsToastTimer = 0;
function fsToast(text: string) {
  let el = document.querySelector<HTMLDivElement>('.fs-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fs-toast';
    app.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(fsToastTimer);
  fsToastTimer = window.setTimeout(() => el!.classList.remove('show'), 3500);
}

document.addEventListener('fullscreenchange', () => {
  fsToast(isFs() ? 'полный экран · F или Esc — выйти' : 'оконный режим · F — снова на весь экран');
});

// F — переключить полный экран в любой момент
addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') { e.preventDefault(); void toggleFs(); }
});

// PLAY включает полный экран (жест пользователя есть) — на десктопе
menu.querySelector('#start')!.addEventListener('click', () => {
  if (!IS_MOBILE) void enterFs();
});

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
