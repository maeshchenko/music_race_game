import * as Tone from 'tone';

/**
 * Звуки подбора: короткий «дзынь», питч ползёт вверх по пентатонике
 * с ростом комбо. Фиксированный пул моносинтов + троттлинг — PolySynth
 * на шторме подборов перегружал аудиопоток (звук пропадал, часы скакали).
 */
export class Sfx {
  private pool: Tone.Synth[] = [];
  private next = 0;
  private lastAt = 0;
  private thud: Tone.Synth;

  constructor() {
    for (let i = 0; i < 4; i++)
      this.pool.push(new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.06 },
        volume: -14,
      }).toDestination());
    this.thud = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.05 },
      volume: -20,
    }).toDestination();
  }

  collect(combo: number, fever = false, count = 1) {
    const now = performance.now();
    if (now - this.lastAt < 55) return; // не чаще ~18/с
    this.lastAt = now;
    // лестница первые 10 блоков (C5→A6), дальше — мелодическая петля
    // по верхней пентатонике: комбо живёт, но без писка и монотонности
    const PENTA = [0, 2, 4, 7, 9];
    const LOOP = [9, 8, 7, 8, 9, 7, 6, 8];
    const step = combo <= 10 ? combo - 1 : LOOP[(combo - 11) % LOOP.length];
    const midi = 72 + PENTA[step % 5] + 12 * Math.floor(step / 5) + (fever ? 7 : 0);
    const play = (m: number) => {
      const synth = this.pool[this.next++ % this.pool.length];
      synth.triggerAttackRelease(Tone.Frequency(Math.min(m, 100), 'midi').toFrequency(), 0.09);
    };
    play(midi);
    // блок-аккорд звенит аккордом: квинта, на тройном — ещё октава
    if (count >= 2) play(midi + 7);
    if (count >= 3) play(midi + 12);
  }

  miss() {
    this.thud.triggerAttackRelease(110, 0.07);
  }

  dispose() {
    for (const s of this.pool) s.dispose();
    this.thud.dispose();
  }
}
