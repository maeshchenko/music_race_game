/**
 * Бесконечная дорога сессии — одна непрерывная лента на все треки. Боковое
 * смещение и рельеф — гладкие функции глобальной дистанции (сумма синусов с
 * сидовыми фазами), поэтому СШИВКИ ГЕОМЕТРИИ НЕТ В ПРИНЦИПЕ: между треками
 * дорога просто продолжается, без шва и без резких поворотов. Песни задают
 * только скорость/блоки/музыку, но не форму дороги (раньше пер-песенная кривая
 * на стыке загибалась на 90° — отсюда «однополосная дорога сквозь дома»).
 *
 * Амплитуды/длины волн подобраны под плавные размашистые повороты и пологие
 * холмы: наклон оси ≲0.06 рад (~3.5°) — машина всегда на дороге.
 */
export interface Road {
  curveAt(d: number): number;
  heightAt(d: number): number;
  /** Полосность дороги на дистанции d: 0 — 2 полосы, 1 — 3 полосы (шоссе),
   *  непрерывно (плавные мёржи на границе район-город↔остальные). */
  wideAt(d: number): number;
  /** Тип района на дистанции d: 0 провинция, 1 поле, 2 город(+шоссе). Дискретно. */
  districtAt(d: number): number;
}

function lcg(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// --- районы вдоль дистанции: провинция / поле / город(+шоссе) ---------------
// Дорога нарезана на районы длиной ~DIST_LEN. Тип района — детерминированный
// хеш по индексу: провинция (база), поле, город. Город = 3 полосы (шоссе),
// остальные — 2 полосы. Ширина плавно мёржится только на границе город↔не-город.
const DIST_LEN = 650;   // длина одного района, м
const RAMP = 55;        // плавный мёрж ширины 2↔3 на границе, м
// пороги типа района: 0 провинция (40%), 1 поле (30%), 2 город (30%)
const P_PROVINCE = 0.4;
const P_FIELD = 0.7;

const smoothstep = (t: number) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Random-access детерминированный хеш по индексу района → [0,1). */
function hashK(k: number, seed: number, salt: number): number {
  let h = (Math.imul(k, 73856093) ^ Math.imul(seed | 0, 19349663) ^ Math.imul(salt, 83492791)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Тип района по индексу: 0 провинция, 1 поле, 2 город. */
function districtType(k: number, seed: number): number {
  if (k < 4) return 0; // первая трасса (~первые ~2.6 км) — всегда провинция (спокойный старт + снег/ночь)
  const h = hashK(k, seed, 7);
  return h < P_PROVINCE ? 0 : h < P_FIELD ? 1 : 2;
}

function makeProfile(seed: number) {
  const cityTarget = (k: number) => (districtType(k, seed) === 2 ? 1 : 0);
  // ширина: 1 в городских районах, 0 иначе; плавный мёрж по ±RAMP вокруг границы
  const wideAt = (d: number) => {
    const k = Math.floor(d / DIST_LEN);
    const frac = d / DIST_LEN - k; // 0..1 внутри района
    const here = cityTarget(k);
    const r = RAMP / DIST_LEN;
    if (frac < r) return lerp(cityTarget(k - 1), here, smoothstep(0.5 + frac / (2 * r)));
    if (frac > 1 - r) return lerp(here, cityTarget(k + 1), smoothstep((frac - (1 - r)) / (2 * r)));
    return here;
  };
  const districtAt = (d: number) => districtType(Math.floor(d / DIST_LEN), seed);
  return { wideAt, districtAt };
}

// --- математика полос (общая для blocks/traffic/world/game) ----------------
// 2 полосы: полотно ~6.8м, центры полос ±1.7 (полоса ~3.4м), 1 линия по центру.
// 3 полосы: полотно ~11.2м, центры −3.6/0/+3.6, 2 линии-разделителя (±1.8) → три
// ПОЛНОЦЕННЫЕ полосы. Контраст ширины заметный (расширение почти в 1.6×).
const HALF_NARROW = 3.4;  // полуширина дороги: 2 полосы
export const HALF_WIDE = 5.6; // 3 полосы (= ROAD_W/2 в world)
const OUTER_NARROW = 1.7; // центр внешней полосы при 2 полосах (±1.7)
const OUTER_WIDE = 3.6;   // при 3 полосах (±3.6, средняя = 0)
/** X линии-разделителя между средней и крайней полосой (3-полосный участок). */
export const LANE_DIVIDER = OUTER_WIDE / 2; // 1.8

/** Полуширина проезжей части при полосности w∈[0,1]. */
export const halfWidth = (w: number) => lerp(HALF_NARROW, HALF_WIDE, w);
/** Боковое смещение центра полосы lane∈{-1,0,1} при полосности w. */
export const laneOffset = (lane: number, w: number) =>
  lane === 0 ? 0 : Math.sign(lane) * lerp(OUTER_NARROW, OUTER_WIDE, w);
/** Доступные полосы при w: 2 полосы (без центра) или 3. */
export const availableLanes = (w: number): number[] => (w >= 0.5 ? [-1, 0, 1] : [-1, 1]);
/** Предел руля (|x|) — машина держится в пределах проезжей части. */
export const steerRange = (w: number) => halfWidth(w) - 0.9;

/**
 * Доп. изгиб ПЕШЕЙ ТРОПЫ (лес/роща/озеро) поверх оси дороги — петляющая тропка,
 * а не прямая трасса. Короче волны и круче, чем у дороги (шаг ~10–30 м). Одна и
 * та же функция кормит и расстановку деревьев (world), и путь камеры/ходьбы
 * (game) — поэтому тропа и просвет между деревьями совпадают.
 */
export const trailWeave = (d: number): number =>
  5.5 * Math.sin(d / 17 + 0.7) + 2.8 * Math.sin(d / 6.7 + 2.1);
/** Производная trailWeave — для направления взгляда вдоль тропы. */
export const trailWeaveSlope = (d: number): number =>
  (5.5 / 17) * Math.cos(d / 17 + 0.7) + (2.8 / 6.7) * Math.cos(d / 6.7 + 2.1);

/**
 * РЕЗКИЙ ПОВОРОТ-АВАРИЯ: на последних ~45 м перед `center` дорога круто уходит в
 * сторону `side` (видно издали — «вписаться нельзя»). После апекса держим смещение
 * (дорога ушла, а мы летим прямо). Одна и та же функция в world (рендер дороги) и
 * game (путь машины) — поэтому машина реально едет в поворот, а потом срывается.
 */
export function crashBend(d: number, center: number, side: number): number {
  const x = (d - (center - 45)) / 45; // 0 за 45 м до апекса → 1 в апексе
  if (x <= 0) return 0;
  const s = x < 1 ? x * x * (3 - 2 * x) : 1; // smoothstep, дальше держим
  return side * 28 * s; // до ~28 м вбок — крутой вираж
}

export function makeRoad(seed: number): Road {
  const r = lcg(seed);
  const TAU = Math.PI * 2;
  const cp = [r() * TAU, r() * TAU, r() * TAU]; // фазы поворотов
  const hp = [r() * TAU, r() * TAU, r() * TAU]; // фазы холмов
  const prof = makeProfile(Math.floor(seed));
  return {
    wideAt: prof.wideAt,
    districtAt: prof.districtAt,
    // боковое смещение ±~19 м, наклон до ~0.17 рад (~10°) — выраженные виражи
    curveAt: (d) =>
      10.0 * Math.sin(d / 210 + cp[0])
      + 6.0 * Math.sin(d / 95 + cp[1])
      + 3.0 * Math.sin(d / 55 + cp[2]),
    // холмы ±~23 м, подъёмы/спуски до ~0.13 рад (~7.5°) — заметный рельеф
    heightAt: (d) =>
      13.0 * Math.sin(d / 360 + hp[0])
      + 7.0 * Math.sin(d / 150 + hp[1])
      + 3.0 * Math.sin(d / 62 + hp[2]),
  };
}
