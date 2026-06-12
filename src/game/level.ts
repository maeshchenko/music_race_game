import type { Song } from 'midi-gen/core';

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

const SPEED_PER_BPM = 0.165; // м/с на единицу BPM
const DS = 4; // шаг сетки дороги, м
const SIM_DT = 0.05; // шаг симуляции скорости, с
const A_LAT = 4.0; // допустимое боковое ускорение в повороте, м/с²

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
  const barTicks = (song.ppq * 4 * song.timeSig[0]) / song.timeSig[1];
  const secPerTick = 60 / (song.ppq * song.bpm);
  const barSec = barTicks * secPerTick;
  const bars = Math.max(1, Math.ceil(song.durationTicks / barTicks));
  const durationSec = song.durationTicks * secPerTick;

  // энергия такта (сумма velocity) — музыкальная составляющая темпа
  const loud = new Array<number>(bars).fill(0);
  for (const tr of song.tracks)
    for (const n of tr.notes) {
      const b = Math.min(bars - 1, Math.floor(n.start / barTicks));
      loud[b] += n.vel;
    }
  const peak = Math.max(...loud, 1);
  const energy = loud.map((_, i) => {
    let s = 0, c = 0;
    for (let j = i - 1; j <= i + 1; j++)
      if (j >= 0 && j < bars) { s += loud[j] / peak; c++; }
    return s / c;
  });
  const energyAt = (t: number) =>
    energy[clamp(Math.floor(t / barSec), 0, bars - 1)];

  // --- дорога: сегментные профили кривизны и уклона --------------------

  const vBase = song.bpm * SPEED_PER_BPM;
  const maxDist = vBase * 1.9 * durationSec + 800;
  const n = Math.ceil(maxDist / DS) + 2;
  const kap = new Float32Array(n); // кривизна, 1/м
  const grd = new Float32Array(n); // уклон, м/м
  const rnd = lcg(Number(song.seed % 2147483646n));

  // кривизна: прямая / длинный плавный / короткий поворот, плавные въезды
  {
    let i = 0, psi = 0; // psi — текущий азимут, держим в пределах ±0.45
    while (i < n) {
      const r = rnd();
      let len: number, dpsi: number;
      if (r < 0.32) { len = 160 + rnd() * 260; dpsi = 0; }            // прямая
      else if (r < 0.7) { len = 240 + rnd() * 300; dpsi = 0.25 + rnd() * 0.3; } // долгий плавный
      else { len = 90 + rnd() * 110; dpsi = 0.3 + rnd() * 0.25; }     // короткий, покруче
      let sign = rnd() < 0.5 ? -1 : 1;
      if (psi > 0.22) sign = -1;
      else if (psi < -0.22) sign = 1;
      dpsi = clamp(dpsi * sign, -0.45 - psi, 0.45 - psi);
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

  // уклон: ровно / затяжной подъём / затяжной спуск
  {
    let i = 0, hCur = 0;
    while (i < n) {
      const r = rnd();
      const len = 220 + rnd() * 420;
      let g: number;
      if (r < 0.3) g = 0;
      else g = (0.022 + rnd() * 0.04) * (r < 0.65 ? 1 : -1);
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

  const steps = Math.ceil(durationSec / SIM_DT) + 2;
  const sArr = new Float32Array(steps);
  const vArr = new Float32Array(steps);
  {
    let s = 0, v = vBase * 0.5;
    for (let k = 0; k < steps; k++) {
      sArr[k] = s;
      vArr[k] = v;
      const i = clamp(Math.floor(s / DS), 0, n - 1);
      // смотрим на 35 м вперёд — тормозим заранее
      const iAhead = clamp(i + Math.round(35 / DS), 0, n - 1);
      const kHere = Math.max(Math.abs(kap[i]), Math.abs(kap[iAhead]));
      const g = grd[i];
      let vLim = vBase * (0.7 + 0.5 * energyAt(k * SIM_DT));
      vLim = Math.min(vLim, Math.sqrt(A_LAT / Math.max(kHere, 1e-5)));
      vLim *= clamp(1 - g * 6, 0.55, 1.4); // в гору медленнее, с горы быстрее
      const kDyn = v > vLim ? 1.6 : 0.35; // тормоз злее разгона
      const a = clamp(kDyn * (vLim - v) - 9.8 * g, -7, 3.2);
      v = Math.max(6, v + a * SIM_DT);
      s += v * SIM_DT;
    }
  }
  const totalDist = sArr[steps - 1];

  const sampleT = (a: Float32Array, t: number) => {
    const f = clamp(t, 0, durationSec) / SIM_DT;
    const i = Math.min(steps - 2, Math.floor(f));
    return a[i] + (a[i + 1] - a[i]) * (f - i);
  };

  return {
    durationSec,
    totalDist,
    distAt: (t) => sampleT(sArr, t),
    speedAt: (t) => sampleT(vArr, t),
    heightAt: (d) => sample(hArr, d),
    curveAt: (d) => sample(xArr, d),
  };
}
