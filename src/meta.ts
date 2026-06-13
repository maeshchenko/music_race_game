/**
 * Мета-прогрессия первой сессии: валюта-ноты, XP-уровни игрока, скины машины,
 * миссии (3 слота), гачапон-капсулы. Всё в localStorage, всё офлайн.
 *
 * Цель — чтобы «следующая награда всегда близко»: на любом экране результатов
 * виден прогресс хотя бы одной цели (XP-полоса, миссия 2/3, до анлока N нот).
 */

const KEY = 'race2107:meta';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface SkinDef {
  id: string;
  name: string;
  color: number;
  price: number; // 0 — стартовый, выдан сразу
  rarity: Rarity;
}

/** Редкость → вес в капсуле, компенсация за дубль, цвет рамки. */
export const RARITY: Record<Rarity, { weight: number; dupe: number; css: string; label: string }> = {
  common: { weight: 100, dupe: 40, css: '#b9bec6', label: 'ОБЫЧНЫЙ' },
  rare: { weight: 45, dupe: 90, css: '#4da6ff', label: 'РЕДКИЙ' },
  epic: { weight: 16, dupe: 200, css: '#c46bff', label: 'ЭПИК' },
  legendary: { weight: 4, dupe: 450, css: '#ffd24d', label: 'ЛЕГЕНДА' },
};

/** Скины «семёрки»: цвет кузова. Чистая косметика — коллекция как горизонт. */
export const SKINS: SkinDef[] = [
  { id: 'cherry', name: 'ВИШНЯ', color: 0x6b1220, price: 0, rarity: 'common' },
  { id: 'milk', name: 'БЕЛАЯ НОЧЬ', color: 0xd8d8d0, price: 1200, rarity: 'common' },
  { id: 'sand', name: 'ПЕСОК', color: 0xb8a060, price: 2000, rarity: 'common' },
  { id: 'sea', name: 'МОРСКАЯ ВОЛНА', color: 0x1f6b6b, price: 2200, rarity: 'rare' },
  { id: 'graphite', name: 'ГРАФИТ', color: 0x2a2d34, price: 3200, rarity: 'rare' },
  { id: 'neon', name: 'НЕОН-ФИОЛЕТ', color: 0x7a2cff, price: 4800, rarity: 'epic' },
  { id: 'gold', name: 'ЗОЛОТО', color: 0xc8a020, price: 7500, rarity: 'epic' },
  { id: 'plasma', name: 'ПЛАЗМА', color: 0xff2c8a, price: 11000, rarity: 'legendary' },
];

/** Типы целей миссий — генерим случайно, проверяем по факту заезда. */
export interface Mission {
  id: string;
  text: string;
  goal: number;
  metric: 'blocks' | 'combo' | 'magnets' | 'mystery' | 'gold' | 'nocrash' | 'score';
  progress: number; // прогресс в рамках одного заезда (для nocrash — секунды)
  done: boolean;
}

interface MetaState {
  notes: number;
  xp: number; // суммарный опыт
  level: number;
  skin: string;
  owned: string[];
  skinCounts: Record<string, number>; // сколько каждого скина выпало (гача-прогресс)
  missions: Mission[];
  capsules: number; // невскрытые капсулы (награда за левел-ап)
  setBonus: number; // постоянный +множитель очков за выполненные сеты миссий
  // накопительная витрина
  totalBlocks: number;
  totalRuns: number;
  bestCombo: number;
  sessionRuns: number; // сбрасывается при перезагрузке — счётчик «N-й заезд сегодня»
}

const FRESH: MetaState = {
  notes: 0, xp: 0, level: 1, skin: 'cherry', owned: ['cherry'],
  skinCounts: { cherry: 1 },
  missions: [], capsules: 0, setBonus: 0,
  totalBlocks: 0, totalRuns: 0, bestCombo: 0, sessionRuns: 0,
};

function load(): MetaState {
  try {
    const s = { ...FRESH, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    if (!s.owned.includes('cherry')) s.owned.push('cherry');
    if (!s.skinCounts) s.skinCounts = {};
    // подтянуть счётчики для уже владеемых скинов (миграция старых сейвов)
    for (const id of s.owned) if (!s.skinCounts[id]) s.skinCounts[id] = 1;
    return s;
  } catch { return { ...FRESH }; }
}

let state = load();
state.sessionRuns = 0; // новая загрузка = новая сессия
save();

function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

// --- XP-кривая: каждый уровень дороже, левел-ап даёт капсулу ----------------

/**
 * Сколько суммарного XP нужно для уровня lvl. Дорогая кривая: один заезд
 * даёт ~700–900 XP, цена уровня растёт (700 → 1650 → 2850 …), так что
 * первые уровни ≈ заезд каждый, дальше реже. Иначе капсулы сыплются.
 */
export function xpForLevel(lvl: number): number {
  return 700 * (lvl - 1) + 125 * (lvl - 1) * (lvl - 2);
}

const CAPS_PER_RUN = 2; // жёсткий кап: максимум 2 капсулы за гонку

export interface LevelUp { levels: number; capsules: number; }

/** Добавить XP, вернуть взятые уровни и капсулы (капсул ≤ CAPS_PER_RUN). */
function addXp(amount: number): LevelUp {
  state.xp += amount;
  let levels = 0;
  while (state.xp >= xpForLevel(state.level + 1)) {
    state.level++;
    levels++;
  }
  const capsules = Math.min(levels, CAPS_PER_RUN);
  state.capsules += capsules;
  return { levels, capsules };
}

// --- миссии: 3 слота, выполненная заменяется новой -------------------------

const MISSION_POOL: Array<Omit<Mission, 'id' | 'progress' | 'done'>> = [
  { text: 'собрать {n} блоков', goal: 60, metric: 'blocks' },
  { text: 'собрать {n} блоков', goal: 100, metric: 'blocks' },
  { text: 'комбо x{n}', goal: 20, metric: 'combo' },
  { text: 'комбо x{n}', goal: 35, metric: 'combo' },
  { text: 'поймать {n} магнита', goal: 2, metric: 'magnets' },
  { text: 'вскрыть {n} мистери', goal: 3, metric: 'mystery' },
  { text: 'поймать джекпот', goal: 1, metric: 'gold' },
  { text: 'проехать {n}с без аварий', goal: 30, metric: 'nocrash' },
  { text: 'набрать {n} очков', goal: 4000, metric: 'score' },
];

let missionSeq = 0;
function makeMission(): Mission {
  const t = MISSION_POOL[Math.floor(Math.random() * MISSION_POOL.length)];
  return {
    id: `m${++missionSeq}`,
    text: t.text.replace('{n}', String(t.goal)),
    goal: t.goal, metric: t.metric, progress: 0, done: false,
  };
}

function ensureMissions() {
  while (state.missions.length < 3) state.missions.push(makeMission());
}
ensureMissions();
save();

/** Факты одного заезда — для проверки миссий на финише. */
export interface RunStats {
  blocks: number;
  maxCombo: number;
  magnets: number;
  mystery: number;
  gold: number;
  noCrashSec: number; // максимум секунд без аварии за заезд
  score: number;
}

export interface MissionResult { mission: Mission; justDone: boolean; }

/** Проверить миссии по статам заезда, выполненные заменить. Вернуть состояние. */
function checkMissions(rs: RunStats): MissionResult[] {
  const out: MissionResult[] = [];
  let setCompleted = false;
  for (const m of state.missions) {
    if (m.done) { out.push({ mission: m, justDone: false }); continue; }
    const v = rs[
      m.metric === 'blocks' ? 'blocks'
      : m.metric === 'combo' ? 'maxCombo'
      : m.metric === 'magnets' ? 'magnets'
      : m.metric === 'mystery' ? 'mystery'
      : m.metric === 'gold' ? 'gold'
      : m.metric === 'nocrash' ? 'noCrashSec'
      : 'score'
    ];
    m.progress = Math.min(m.goal, v);
    if (v >= m.goal) { m.done = true; out.push({ mission: m, justDone: true }); }
    else out.push({ mission: m, justDone: false });
  }
  // весь сет (3/3) выполнен → постоянный бонус-множитель и свежий сет
  if (state.missions.every((m) => m.done)) {
    state.setBonus = +(state.setBonus + 0.1).toFixed(2);
    state.missions = [];
    ensureMissions();
    setCompleted = true;
  } else {
    // заменить только выполненные
    state.missions = state.missions.filter((m) => !m.done);
    ensureMissions();
  }
  (out as MissionResult[] & { setCompleted?: boolean }).setCompleted = setCompleted;
  return out;
}

// --- публичное API ----------------------------------------------------------

export interface RunReward {
  notesEarned: number;
  levelUp: LevelUp;
  missions: MissionResult[];
  setCompleted: boolean;
  nextUnlock: { name: string; price: number; have: number } | null;
}

/** Итог заезда: начислить ноты+XP, проверить миссии. wheelMult — с колеса. */
export function applyRun(rs: RunStats, baseNotes: number, wheelMult: number): RunReward {
  const notesEarned = Math.round(baseNotes * wheelMult);
  state.notes += notesEarned;
  const levelUp = addXp(rs.blocks * 10 + rs.maxCombo * 5 + Math.round(rs.score / 50));
  const missions = checkMissions(rs);
  const setCompleted = !!(missions as MissionResult[] & { setCompleted?: boolean }).setCompleted;
  state.totalBlocks += rs.blocks;
  state.totalRuns++;
  state.sessionRuns++;
  state.bestCombo = Math.max(state.bestCombo, rs.maxCombo);
  save();
  return { notesEarned, levelUp, missions, setCompleted, nextUnlock: nextUnlock() };
}

/** Ближайший непокупленный скин — цель «до анлока N нот». */
export function nextUnlock(): { name: string; price: number; have: number } | null {
  const next = SKINS
    .filter((s) => !state.owned.includes(s.id))
    .sort((a, b) => a.price - b.price)[0];
  return next ? { name: next.name, price: next.price, have: state.notes } : null;
}

export function buySkin(id: string): boolean {
  const s = SKINS.find((x) => x.id === id);
  if (!s || state.owned.includes(id) || state.notes < s.price) return false;
  state.notes -= s.price;
  state.owned.push(id);
  state.skinCounts[id] = (state.skinCounts[id] ?? 0) + 1;
  save();
  return true;
}

export function equipSkin(id: string) {
  if (state.owned.includes(id)) { state.skin = id; save(); }
}

export interface CapsuleResult {
  skin: SkinDef; // что выпало (всегда есть — это гача-крутка)
  isNew: boolean; // новый скин или дубль
  notes: number; // компенсация за дубль (0 если новый)
  count: number; // сколько всего таких скинов уже собрано (прогресс)
}

/**
 * Гача-крутка: тянем скин по весу редкости. Дубли РАЗРЕШЕНЫ — в этом суть
 * гачи: variable-ratio тяга «вдруг легенда». Дубль конвертится в ноты по
 * редкости (классическая дубль-защита), так что крутка всегда не впустую.
 */
export function openCapsule(): CapsuleResult | null {
  if (state.capsules <= 0) return null;
  state.capsules--;
  // взвешенный выбор по редкости
  const total = SKINS.reduce((s, sk) => s + RARITY[sk.rarity].weight, 0);
  let r = Math.random() * total;
  let got = SKINS[0];
  for (const sk of SKINS) {
    r -= RARITY[sk.rarity].weight;
    if (r <= 0) { got = sk; break; }
  }
  const isNew = !state.owned.includes(got.id);
  let notes = 0;
  if (isNew) state.owned.push(got.id);
  else { notes = RARITY[got.rarity].dupe; state.notes += notes; }
  state.skinCounts[got.id] = (state.skinCounts[got.id] ?? 0) + 1;
  save();
  return { skin: got, isNew, notes, count: state.skinCounts[got.id] };
}

/** Сколько штук скина собрано (для бейджа «xN» в гараже). */
export function skinCount(id: string): number {
  return state.skinCounts[id] ?? 0;
}

export const meta = {
  get notes() { return state.notes; },
  get level() { return state.level; },
  get xp() { return state.xp; },
  get capsules() { return state.capsules; },
  get skin() { return state.skin; },
  get skinColor() { return SKINS.find((s) => s.id === state.skin)?.color ?? 0x6b1220; },
  get owned() { return state.owned; },
  get missions() { return state.missions; },
  get setBonus() { return state.setBonus; },
  get sessionRuns() { return state.sessionRuns; },
  get totalBlocks() { return state.totalBlocks; },
  get totalRuns() { return state.totalRuns; },
  get bestCombo() { return state.bestCombo; },
  /** Прогресс XP внутри текущего уровня: [взято, нужно]. */
  xpInLevel() {
    const lo = xpForLevel(state.level);
    const hi = xpForLevel(state.level + 1);
    return { have: state.xp - lo, need: hi - lo };
  },
};
