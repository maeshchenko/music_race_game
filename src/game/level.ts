import type { Song } from 'midi-gen/core';
import { analyzeSong } from '../music';

/**
 * Уровень: трасса — сегментная (прямые, плавные и короткие повороты,
 * затяжные подъёмы/спуски), детерминированная сидом трека. Скорость —
 * симуляция: разгон на прямых и спусках, торможение в гору и перед
 * крутыми поворотами; музыка задаёт базовый темп (BPM + энергия секции).
 * Длительность поездки всегда равна длительности трека.
 */
export interface Level {
  durationSec: number;
  totalDist: number;
  /** Пройденная дистанция (м) к моменту t секунд музыки. */
  distAt(t: number): number;
  /** Скорость (м/с) в момент t. */
  speedAt(t: number): number;
  /** Высота трассы (м) на дистанции dist. */
  heightAt(dist: number): number;
  /** Боковое смещение оси дороги (м) на дистанции dist — повороты. */
  curveAt(dist: number): number;
}

// скорость = база + bpm·коэф: компрессия, чтобы быстрые треки (BPM 150+) не
// улетали в 250 км/ч, а типичные ~100 BPM давали ~110 на прямой
const SPEED_BASE = 22; // м/с при 0 BPM
const SPEED_PER_BPM = 0.06; // прибавка м/с на единицу BPM
const DS = 4; // шаг сетки дороги, м
const SIM_DT = 0.05; // шаг симуляции скорости, с
const A_LAT = 7.0; // допустимое боковое ускорение в повороте, м/с² (выше — меньше режет)

/** Детерминированный PRNG из сида трека — трасса у кода всегда одна. */
function lcg(seed: number): () => number {
  let s = (seed % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function buildLevel(song: Song): Level {
  const secPerTick = 60 / (song.ppq * song.bpm);
  const durationSec = song.durationTicks * secPerTick;

  // музыкальные фичи: повороты ← мелодия, холмы ← энергия, темп ← энергия
  const feat = analyzeSong(song);
  const { barSec, bars } = feat;
  const energyAt = (t: number) =>
    feat.energy[clamp(Math.floor(t / barSec), 0, bars - 1)];

  // --- дорога: сегментные профили кривизны и уклона --------------------

  const vBase = SPEED_BASE + song.bpm * SPEED_PER_BPM;
  const maxDist = vBase * 1.9 * durationSec + 800;
  const n = Math.ceil(maxDist / DS) + 2;
  const kap = new Float32Array(n); // кривизна, 1/м
  const grd = new Float32Array(n); // уклон, м/м
  const rnd = lcg(Number(song.seed % 2147483646n));

  // дистанция → такт (по номинальной крейсерской скорости; точный тайминг
  // даёт симуляция позже, но геометрия фич синхронится достаточно близко)
  const barLenM = Math.max(40, vBase * barSec);
  const barAtDist = (d: number) => clamp(Math.floor(d / barLenM), 0, bars - 1);

  // кривизна: повороты на мелодических ходах, прямые где мелодия ровная.
  // фраза ~1.5–2.5 такта; сила = 55% мелодия + 35% seed-джиттер (органично)
  {
    let i = 0, psi = 0; // psi — азимут, держим в пределах ±0.45
    while (i < n) {
      const phraseBars = 1.5 + rnd();
      const len = clamp(phraseBars * barLenM, 120, 520);
      const b0 = barAtDist(i * DS);
      const b1 = clamp(b0 + Math.round(phraseBars), 0, bars - 1);
      const dMel = feat.melody[b1] - feat.melody[b0]; // -1..1, ход мелодии
      let mag = Math.abs(dMel) * 0.4 + rnd() * 0.22;   // мягче — меньше резких углов
      let sign = dMel > 0.05 ? 1 : dMel < -0.05 ? -1 : (rnd() < 0.5 ? -1 : 1);
      if (Math.abs(dMel) < 0.06 && rnd() < 0.6) mag = 0; // чаще прямые → ровнее ход
      if (psi > 0.22) sign = -1;
      else if (psi < -0.22) sign = 1;
      const dpsi = clamp(mag * sign, -0.45 - psi, 0.45 - psi);
      const pts = Math.max(4, Math.round(len / DS));
      const ramp = Math.min(Math.round(50 / DS), pts >> 1);
      const kappa = dpsi / len;
      for (let j = 0; j < pts && i < n; j++, i++) {
        const w = j < ramp ? j / ramp : j >= pts - ramp ? (pts - j) / ramp : 1;
        kap[i] = kappa * w;
        psi += kap[i] * DS;
      }
    }
  }

  // уклон: подъёмы в громкие секции, спуски в тихие (рост энергии → вверх).
  {
    let i = 0, hCur = 0;
    while (i < n) {
      const len = 220 + rnd() * 300;
      const phraseBars = Math.max(1, Math.round(len / barLenM));
      const b0 = barAtDist(i * DS);
      const b1 = clamp(b0 + phraseBars, 0, bars - 1);
      const dE = feat.energy[b1] - feat.energy[b0]; // -1..1, ход энергии
      let g = clamp(dE * 0.09, -0.05, 0.05) + (rnd() - 0.5) * 0.012;
      if (hCur > 50) g = -Math.abs(g || 0.03);
      else if (hCur < -30) g = Math.abs(g || 0.03);
      const pts = Math.max(4, Math.round(len / DS));
      const ramp = Math.min(Math.round(70 / DS), pts >> 1);
      for (let j = 0; j < pts && i < n; j++, i++) {
        const w = j < ramp ? j / ramp : j >= pts - ramp ? (pts - j) / ramp : 1;
        grd[i] = g * w;
        hCur += grd[i] * DS;
      }
    }
  }

  // интегралы: боковое смещение оси и высота
  const xArr = new Float32Array(n);
  const hArr = new Float32Array(n);
  {
    let psi = 0;
    for (let i = 0; i < n - 1; i++) {
      psi += kap[i] * DS;
      xArr[i + 1] = xArr[i] + psi * DS; // малые углы: tan ψ ≈ ψ
      hArr[i + 1] = hArr[i] + grd[i] * DS;
    }
  }

  const sample = (a: Float32Array, d: number) => {
    const f = clamp(d, 0, (n - 2) * DS) / DS;
    const i = Math.floor(f);
    return a[i] + (a[i + 1] - a[i]) * (f - i);
  };

  // --- скорость: симуляция по времени -----------------------------------
  // Лимит = музыкальный темп × поворот × уклон; разгон мягкий, тормоз
  // резкий — перед крутым поворотом скорость сбрасывается заранее сама
  // (лимит падает раньше, чем машина доезжает, за счёт плавных въездов).

  const VMIN = 25; // нижний предел скорости, м/с (~90 км/ч) — не едем медленнее
// опорная скорость стыка: каждый сегмент в endless начинается/кончается на ней,
// поэтому на переходе трек→трек скорость непрерывна (нет толчка). Середина трека
// по-прежнему гуляет по энергии музыки — сварка только у концов.
const VREF = 30; // ~108 км/ч
  const steps = Math.ceil(durationSec / SIM_DT) + 2;
  const sArr = new Float32Array(steps);
  const vArr = new Float32Array(steps);
  {
    let s = 0, v = Math.max(VMIN, vBase * 0.7);
    for (let k = 0; k < steps; k++) {
      sArr[k] = s;
      vArr[k] = v;
      const i = clamp(Math.floor(s / DS), 0, n - 1);
      // смотрим на 35 м вперёд — тормозим заранее
      const iAhead = clamp(i + Math.round(35 / DS), 0, n - 1);
      const kHere = Math.max(Math.abs(kap[i]), Math.abs(kap[iAhead]));
      const g = grd[i];
      // связь скорости с энергией мягче (0.85..1.1 вместо 0.7..1.2) — ровнее ход
      let vLim = vBase * (0.85 + 0.25 * energyAt(k * SIM_DT));
      vLim = Math.min(vLim, Math.sqrt(A_LAT / Math.max(kHere, 1e-5)));
      vLim *= clamp(1 - g * 6, 0.55, 1.4); // в гору медленнее, с горы быстрее
      const kDyn = v > vLim ? 1.6 : 0.35; // тормоз злее разгона
      const a = clamp(kDyn * (vLim - v) - 9.8 * g, -8, 5);
      v = Math.max(VMIN, v + a * SIM_DT); // не ниже 90 км/ч
      s += v * SIM_DT;
    }
  }

  // сварка скорости у концов: плавно тянем старт и финиш к VREF (окно ~2.5 с),
  // затем переинтегрируем дистанцию из сваренной скорости — distAt остаётся
  // согласован с blocks (они садятся на distAt тех же нот). Стык трек→трек
  // теперь без толчка: обе стороны едут VREF.
  {
    const wl = Math.min(steps >> 2, Math.round(2.5 / SIM_DT));
    for (let k = 0; k < wl; k++) {
      const u = k / wl;
      const w = u * u * (3 - 2 * u); // smoothstep 0→1
      vArr[k] = VREF + (vArr[k] - VREF) * w; // старт: VREF → профиль
      const i = steps - 1 - k;
      vArr[i] = VREF + (vArr[i] - VREF) * w; // финиш: профиль → VREF
    }
    sArr[0] = 0;
    for (let k = 1; k < steps; k++)
      sArr[k] = sArr[k - 1] + (vArr[k - 1] + vArr[k]) * 0.5 * SIM_DT;
  }
  const totalDist = sArr[steps - 1];

  const sampleT = (a: Float32Array, t: number) => {
    const f = clamp(t, 0, durationSec) / SIM_DT;
    const i = Math.min(steps - 2, Math.floor(f));
    return a[i] + (a[i + 1] - a[i]) * (f - i);
  };

  // --- сварка концов: ось и высота → 0 у totalDist (и дальше) -----------
  // Бесконечный режим клеит сегменты встык. Если каждый уровень начинается и
  // кончается в (x=0, h=0) с нулевым наклоном, стык — без шва и без излома:
  // следующий сегмент стартует из тех же 0. Старт уже в 0 (интегралы с нуля);
  // хвост плавно гасим smoothstep'ом на участке WELD_M перед totalDist, дальше
  // держим ровно 0 (мир смотрит вперёд за стык до появления нового сегмента).
  {
    const WELD_M = 150;
    const iEnd = clamp(Math.round(totalDist / DS), 1, n - 1);
    const wp = Math.min(iEnd, Math.round(WELD_M / DS));
    for (let k = 0; k < wp; k++) {
      const i = iEnd - wp + k;
      const u = k / wp; // 0 в начале окна → 1 у стыка
      const s = 1 - u * u * (3 - 2 * u); // smoothstep: 1 → 0 к стыку
      xArr[i] *= s;
      hArr[i] *= s;
    }
    for (let i = iEnd; i < n; i++) { xArr[i] = 0; hArr[i] = 0; }
  }

  return {
    durationSec,
    totalDist,
    distAt: (t) => sampleT(sArr, t),
    speedAt: (t) => sampleT(vArr, t),
    heightAt: (d) => sample(hArr, d),
    curveAt: (d) => sample(xArr, d),
  };
}
