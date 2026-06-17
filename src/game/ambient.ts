import * as Tone from 'tone';

/**
 * Ночной амбиент лиричного финала (роща → озеро). Полностью СИНТЕЗ (в духе всей
 * игры — никаких аудио-ассетов): стрёкот цикад/сверчков, низкий фон ночи, плеск
 * воды, редкие птицы. Маршрутизируется МИМО мастер-громкости Tone — поэтому, пока
 * мы рампом приглушаем музыку (мастер), амбиент проступает (честный кроссфейд).
 *
 *  • Сверчки — bandpass-шум ~4–5 кГц с быстрым AM-«трелью» (квадратный LFO),
 *    несколько голосов вразнобой и по панораме.
 *  • Фон ночи — тихий низкочастотный шум (воздух/лес).
 *  • Вода (только озеро) — низкий шум с медленным набеганием (swell-LFO).
 *  • Птицы — редкие тихие чирики (две ноты со скольжением), по таймеру в update().
 */
export class NightAmbient {
  private out: Tone.Gain;       // общий уровень амбиента (0..1), мимо мастера
  private water: Tone.Gain;     // под-уровень воды (поднимается на озере)
  private nodes: { dispose(): void }[] = [];
  // птица = непрерывный осциллятор, частота которого СКОЛЬЗИТ (свип) + вибрато
  // (трель) + амплитудная огибающая (гейт). Так чирик звучит «по-птичьи», а не
  // как ровный бип/системный звук.
  private birdOsc!: Tone.Oscillator;
  private birdEnv!: Tone.AmplitudeEnvelope;
  private birdGain!: Tone.Gain; // громкость текущей птицы (варьируем = ближе/дальше)
  private birdPan!: Tone.Panner;
  private nextBird = 6;          // первая птица не сразу (амбиент успевает проступить)
  private level = 0;             // целевой общий уровень (для update-рампа не нужен — рампим узлом)

  constructor() {
    // raw-выход контекста — В ОБХОД Tone.getDestination() (мастер музыки/громкости),
    // чтобы приглушение музыки не глушило амбиент. Фолбэк — обычный destination.
    const raw = (Tone.getContext().rawContext as AudioContext)?.destination;
    this.out = new Tone.Gain(0);
    if (raw) this.out.connect(raw); else this.out.toDestination();
    this.water = new Tone.Gain(0).connect(this.out);

    // --- сверчки/цикады: 3 голоса вразнобой по частоте/темпу трели/панораме
    const crickets: Array<[number, number, number, number]> = [
      // [частота Гц, темп трели Гц, панорама, уровень]
      [4300, 15, -0.6, 0.05],
      [4800, 19, 0.0, 0.045],
      [5300, 23, 0.65, 0.04],
    ];
    for (const [freq, rate, pan, lvl] of crickets) {
      const noise = new Tone.Noise('white').start();
      const bp = new Tone.Filter({ frequency: freq, type: 'bandpass', Q: 14 });
      const trem = new Tone.Gain(0);
      const lfo = new Tone.LFO({ frequency: rate, min: 0, max: lvl, type: 'square' }).start();
      const panner = new Tone.Panner(pan);
      noise.connect(bp); bp.connect(trem); trem.connect(panner); panner.connect(this.out);
      lfo.connect(trem.gain);
      this.nodes.push(noise, bp, trem, lfo, panner);
    }

    // --- низкий фон ночи: тихий приглушённый шум (воздух/лес)
    {
      const noise = new Tone.Noise('brown').start();
      const lp = new Tone.Filter({ frequency: 320, type: 'lowpass' });
      const g = new Tone.Gain(0.05);
      noise.connect(lp); lp.connect(g); g.connect(this.out);
      this.nodes.push(noise, lp, g);
    }

    // --- вода: низкий шум с медленным набеганием волны (через this.water)
    {
      const noise = new Tone.Noise('brown').start();
      const lp = new Tone.Filter({ frequency: 560, type: 'lowpass' });
      const swell = new Tone.Gain(0);
      const lfo = new Tone.LFO({ frequency: 0.13, min: 0.04, max: 0.5, type: 'sine' }).start();
      noise.connect(lp); lp.connect(swell); swell.connect(this.water);
      lfo.connect(swell.gain);
      this.nodes.push(noise, lp, swell, lfo);
    }

    // --- птицы: осциллятор со СКОЛЬЗЯЩЕЙ частотой (свип) + вибрато (трель) +
    // огибающая. Цепь: osc → vibrato → env → gain → pan → out.
    this.birdPan = new Tone.Panner(0).connect(this.out);
    this.birdGain = new Tone.Gain(0.25).connect(this.birdPan);
    this.birdEnv = new Tone.AmplitudeEnvelope({
      attack: 0.015, decay: 0.04, sustain: 0.75, release: 0.05,
    }).connect(this.birdGain);
    const birdVib = new Tone.Vibrato({ frequency: 24, depth: 0.12 }).connect(this.birdEnv);
    this.birdOsc = new Tone.Oscillator(2000, 'sine').connect(birdVib);
    this.birdOsc.start();
    this.nodes.push(this.birdOsc, birdVib, this.birdEnv, this.birdGain, this.birdPan);
  }

  /** Плавно вывести общий уровень амбиента (0..1) за dur секунд. */
  fadeTo(level: number, dur = 4) {
    this.level = level;
    this.out.gain.rampTo(level, dur);
  }

  /** Поднять/опустить слой воды (озеро). */
  setWater(level: number, dur = 4) { this.water.gain.rampTo(level, dur); }

  /**
   * Кадровый апдейт: редкие птицы (две короткие ноты со скольжением, случайная
   * панорама и пауза). Зовётся каждый кадр; rnd берём из аргумента, чтобы не
   * плодить Math.random зависимостей по месту.
   */
  update(dt: number) {
    if (this.level <= 0.01) return;
    this.nextBird -= dt;
    if (this.nextBird > 0) return;
    this.nextBird = 1.5 + Math.random() * 3.5; // раз в 1.5–5 с
    this.birdPan.pan.value = Math.random() * 1.8 - 0.9;
    // громкость = расстояние: в основном ДАЛЁКИЕ тихие (фон), редко поближе —
    // ровный фон леса, без резких громких писков в уши
    const near = Math.random();
    this.birdGain.gain.value = near < 0.82 ? 0.025 + Math.random() * 0.06 : 0.1 + Math.random() * 0.1;
    const now = Tone.now() + 0.05;
    const f = this.birdOsc.frequency;
    // один чирик = СКОЛЬЗЯЩАЯ частота f0→f1 за dur + гейт огибающей (с вибрато
    // получается живой «птичий» свист, а не ровный бип)
    const chirp = (tStart: number, f0: number, f1: number, dur: number) => {
      f.setValueAtTime(f0, tStart);
      f.exponentialRampToValueAtTime(Math.max(80, f1), tStart + dur);
      this.birdEnv.triggerAttackRelease(dur * 0.9, tStart);
    };
    try {
      const base = 1700 + Math.random() * 900; // 1.7–2.6 кГц
      const kind = Math.random();
      if (kind < 0.4) {
        // «тви-тви»: два чирика вверх
        chirp(now, base * 0.7, base * 1.3, 0.13);
        chirp(now + 0.22, base * 0.75, base * 1.35, 0.12);
      } else if (kind < 0.75) {
        // трель: 5 быстрых коротких чириков
        for (let i = 0; i < 5; i++) chirp(now + i * 0.085, base * 0.85, base * 1.15, 0.06);
      } else {
        // варбл: вверх-вниз одним свистом
        f.setValueAtTime(base * 0.65, now);
        f.exponentialRampToValueAtTime(base * 1.4, now + 0.13);
        f.exponentialRampToValueAtTime(base * 0.85, now + 0.3);
        this.birdEnv.triggerAttackRelease(0.32, now);
      }
    } catch { /* контекст не готов — пропустить */ }
  }

  dispose() {
    for (const n of this.nodes) { try { n.dispose(); } catch { /* уже освобождён */ } }
    this.water.dispose();
    this.out.dispose();
  }
}
