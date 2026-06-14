import * as Tone from 'tone';

/**
 * Звуки подбора (модель Beat Saber/Audiosurf): сбор ДУБЛИРУЕТ реальное событие
 * трека — нота lead, бас, бочка или снейр — поверх играющей музыки. Совпадение
 * удара с музыкой = дофамин, даже если мелодия не узнаётся. Сверху — восходящая
 * в-ключе «искра» по комбо (рост-награда). Промах нейтрален: ноль наказания.
 * Фиксированный пул моносинтов + троттлинг — PolySynth на шторме подборов
 * перегружал аудиопоток.
 */
type Voice = 'lead' | 'bass' | 'kick' | 'snare';
type Genre = 'grimerun' | 'outrun' | 'eurobeat';

/**
 * Пресет тембра сбора под жанр трека — чтобы «дзынь» звучал палитрой музыки, а
 * не чужим треугольником поверх. Меняем только ДЕШЁВЫЕ параметры (osc/env/cutoff/
 * wet) — БЕЗ пере-рендера reverb-IR (decay фиксирован), иначе фриз на стыке.
 */
interface SfxPreset {
  osc: 'sawtooth' | 'square' | 'triangle';
  attack: number; decay: number;
  cutoff: number; // lowpass — палитра яркости
  wet: number;    // доля реверба — «в миксе»
}
const PRESETS: Record<Genre, SfxPreset> = {
  // мрачный индастриал: тёмная пила, глухой фильтр, больше пространства
  grimerun: { osc: 'sawtooth', attack: 0.004, decay: 0.14, cutoff: 2400, wet: 0.22 },
  // synthwave 80х: тёплая пила, средняя яркость, умеренный реверб
  outrun:   { osc: 'sawtooth', attack: 0.003, decay: 0.12, cutoff: 3800, wet: 0.15 },
  // евробит: яркий панч-квадрат, открытый фильтр, суше и резче
  eurobeat: { osc: 'square',   attack: 0.002, decay: 0.10, cutoff: 5400, wet: 0.09 },
};

export class Sfx {
  private pool: Tone.Synth[] = [];
  private next = 0;
  private lastAt = 0;
  private lastSchedule = 0; // монотонное время планирования — Tone не терпит дублей
  private thud: Tone.Synth;
  private kick: Tone.MembraneSynth; // бух на сильную долю — пульс трека
  private bass: Tone.Synth; // дубль басовой ноты
  private snare: Tone.NoiseSynth; // щелчок бэкбита
  private lastKickAt = 0;
  private lastSnareAt = 0;
  // общий тон-бас сбора: lowpass + малый reverb → пул/бас сидят В миксе, не поверх.
  // kick/snare/thud идут сухими мимо него (панч/читаемость удара).
  private filter: Tone.Filter;
  private verb: Tone.Reverb;
  private genre: Genre = 'outrun';

  /**
   * Низколатентное время сбора. Контекст игры — latencyHint:'playback' (большой
   * lookAhead ~150мс): отлично для заранее расписанной музыки, но Tone.now() =
   * currentTime + lookAhead → SFX звучал бы с задержкой ~150мс (тот самый «делэй»).
   * Берём СЫРОЕ время аудио-контекста + крошечный упреждающий зазор → звук
   * срабатывает почти мгновенно, в момент сбора. Монотонный guard — лишь чтобы
   * два события не сели на один тик (Tone кидает на дублях), без убегания вперёд.
   */
  private soon(): number {
    const t = Tone.getContext().rawContext.currentTime + 0.012;
    const safe = Math.max(t, this.lastSchedule + 0.004);
    this.lastSchedule = safe;
    return safe;
  }

  /**
   * Смещение громкости эффектов в дБ поверх базовой. Музыка управляется
   * мастером (Tone.Destination), эффекты компенсируются этим смещением,
   * чтобы ползунки были независимы.
   */
  setOffset(db: number) {
    // лид/бас сбора подняты (−10/−12): сбор = мелодия композиции, не эхо поверх.
    // Лид трека приглушён гидом в conductor → сбор слышен как ведущий голос.
    for (const s of this.pool) s.volume.value = -10 + db;
    this.thud.volume.value = -20 + db;
    this.kick.volume.value = -8 + db;
    this.bass.volume.value = -12 + db;
    this.snare.volume.value = -18 + db;
  }

  constructor() {
    // тон-бас: пул/бас → lowpass → reverb(фикс. decay, варьируем только wet) → выход
    this.verb = new Tone.Reverb({ decay: 1.8, preDelay: 0.01, wet: 0.15 }).toDestination();
    this.filter = new Tone.Filter({ type: 'lowpass', frequency: 3800, Q: 0.6 });
    this.filter.connect(this.verb);
    for (let i = 0; i < 4; i++)
      this.pool.push(new Tone.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.003, decay: 0.12, sustain: 0, release: 0.06 },
        volume: -10, // сбор-лид громче: он и есть мелодия (лид трека приглушён гидом)
      }).connect(this.filter));
    this.thud = new Tone.Synth({
      oscillator: { type: 'square' },
      envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.05 },
      volume: -20,
    }).toDestination();
    // короткий плотный бух: пульс на сильную долю, слышен поверх музыки
    this.kick = new Tone.MembraneSynth({
      pitchDecay: 0.03, octaves: 5,
      envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.02 },
      volume: -8,
    }).toDestination();
    // бас-дубль: короткая плотная пила — тоже через тон-бас (фильтр+реверб)
    this.bass = new Tone.Synth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.004, decay: 0.13, sustain: 0, release: 0.05 },
      volume: -12,
    }).connect(this.filter);
    // снейр-щелчок: короткий белый шум
    this.snare = new Tone.NoiseSynth({
      noise: { type: 'white' },
      envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 },
      volume: -18,
    }).toDestination();
  }

  /**
   * Переключить тембр сбора под жанр текущего трека (вызывать на стыке/смене).
   * Только дешёвые правки — без пере-рендера reverb-IR. Идемпотентно.
   */
  setGenre(g: Genre) {
    if (g === this.genre) return;
    this.genre = g;
    const p = PRESETS[g];
    for (const s of this.pool) {
      s.oscillator.type = p.osc;
      s.envelope.attack = p.attack;
      s.envelope.decay = p.decay;
    }
    this.filter.frequency.rampTo(p.cutoff, 0.3);
    this.verb.wet.rampTo(p.wet, 0.3);
  }

  /** Один тональный «дзынь» из пула (round-robin), velocity 0..1. */
  private tone(midi: number, vel: number) {
    const s = this.pool[this.next++ % this.pool.length];
    s.triggerAttackRelease(Tone.Frequency(Math.min(midi, 103), 'midi').toFrequency(), 0.09, this.soon(), vel);
  }

  collect(
    combo: number, fever = false, count = 1,
    beat: 'strong' | 'weak' | 'off' | 'solo' = 'weak',
    voice: Voice = 'lead', pitch = 72, perfect = false,
  ) {
    // ПУЛЬС: сильная доля или бочка — всегда бух, мимо троттла. Низколатентно
    // (soon) → удар совпадает с тем, что видишь, без делэя муз-движка.
    if (beat === 'strong' || voice === 'kick') {
      const tk = performance.now();
      if (tk - this.lastKickAt > 55) {
        this.lastKickAt = tk;
        this.kick.triggerAttackRelease('C1', 0.16, this.soon(), perfect ? 1 : 0.85);
      }
    }
    // СНЕЙР: щелчок на бэкбит-голосе
    if (voice === 'snare') {
      const ts = performance.now();
      if (ts - this.lastSnareAt > 45) {
        this.lastSnareAt = ts;
        this.snare.triggerAttackRelease(0.05, this.soon());
      }
    }
    // тональный слой троттлим, но чаще прежнего — частое подкрепление
    const now = performance.now();
    if (now - this.lastAt < 38) return; // ~26/с
    this.lastAt = now;
    const bright = Math.min(1, 0.55 + Math.min(combo, 40) * 0.011) * (fever ? 1 : 0.92);
    const clamp = (lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(pitch)));
    // ДУБЛЬ реального события: слышишь, что «сыграл» именно эту ноту трека
    if (voice === 'lead') {
      const m = clamp(60, 96);
      this.tone(m, bright);
      if (count >= 2) this.tone(m + 7, bright * 0.7); // аккорд
      if (count >= 3) this.tone(m + 12, bright * 0.6);
    } else if (voice === 'bass') {
      const m = clamp(28, 52);
      this.bass.triggerAttackRelease(Tone.Frequency(m, 'midi').toFrequency(), 0.13, this.soon(), bright);
    }
    // ИСКРА-награда = тот же КЛАСС высоты, что у собранной ноты, поднятый в
    // звонкую октаву (PERFECT — ещё октавой выше). Всегда в тональности трека →
    // ДОПОЛНЯЕТ песню, а не живёт своей жизнью. Рост-награда — через яркость.
    let s = Math.round(pitch);
    while (s < 67) s += 12; // в звонкий регистр, сохраняя класс высоты (в ключе)
    // искру притушили: ниже потолок (96 вместо 103) + тише → меньше «писка»
    // поверх музыки; lowpass тон-баса снимает резкие верха.
    const spark = Math.min(s + (perfect ? 12 : 0), 96);
    this.tone(spark, perfect ? 0.4 : Math.min(0.3, 0.2 + bright * 0.14));
  }

  // СДВГ-режим: промах нейтрален — никакого негативного звука
  miss() { /* тишина */ }

  /** Джекпот: победное арпеджио вверх, мимо троттлинга — событие редкое. */
  jackpot() {
    const now = this.soon();
    [84, 88, 91, 96].forEach((m, k) => {
      const synth = this.pool[this.next++ % this.pool.length];
      synth.triggerAttackRelease(Tone.Frequency(m, 'midi').toFrequency(), 0.12, now + k * 0.07);
    });
  }

  /** Щелчок барабана слот-машины. */
  tick() {
    const synth = this.pool[this.next++ % this.pool.length];
    synth.triggerAttackRelease(1750, 0.018, this.soon());
  }

  /** Мистери-блок: две быстрые «блёстки». */
  mystery() {
    const now = this.soon();
    [89, 94].forEach((m, k) => {
      const synth = this.pool[this.next++ % this.pool.length];
      synth.triggerAttackRelease(Tone.Frequency(m, 'midi').toFrequency(), 0.08, now + k * 0.05);
    });
  }

  /**
   * Смена музыкального слоя: восходящий ран = разблок слоя (награда, #11),
   * нисходящий = мягкая потеря слоя на срыве (#12). В пентатонике, в ключе.
   */
  riser(up: boolean) {
    const seq = up ? [72, 76, 79, 84, 88] : [88, 84, 79, 76, 72];
    const now = this.soon();
    seq.forEach((m, k) => {
      const s = this.pool[this.next++ % this.pool.length];
      s.triggerAttackRelease(Tone.Frequency(m, 'midi').toFrequency(), 0.08, now + k * 0.045, up ? 0.45 : 0.3);
    });
  }

  /** Финал-климакс: глубокий саб-бум (ощутимый «бах»). */
  boom() {
    const now = this.soon();
    this.kick.triggerAttackRelease('C0', 0.7, now, 1);
    this.kick.triggerAttackRelease('G0', 0.5, now + 0.02, 0.8);
  }

  /** Удар о преграду: низкий глухой бум. */
  crash() {
    const now = this.soon();
    this.thud.triggerAttackRelease(48, 0.3, now);
    this.thud.triggerAttackRelease(65, 0.18, now + 0.05);
  }

  dispose() {
    for (const s of this.pool) s.dispose();
    this.thud.dispose();
    this.kick.dispose();
    this.bass.dispose();
    this.snare.dispose();
    this.filter.dispose();
    this.verb.dispose();
  }
}
