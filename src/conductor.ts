import * as Tone from 'tone';
import type { Song } from 'midi-gen/core';
import { buildEnsemble } from 'midi-gen/audio';

/**
 * Дирижёр бесконечного сета. ОДИН Tone.Transport, который не
 * останавливается между треками — секунды растут непрерывно часами. Каждый
 * трек («стем») подвешивается на свой сдвиг по транспорту: его ноты звучат с
 * startOffset, релизы и реверб-хвосты прошлого трека дозванивают поверх стыка
 * (так миди-движок и держит бесшовные лупы). Машинная позиция игры тянется за
 * глобальной transport.seconds — клок ни разу не обнуляется.
 *
 * Слой = роль трека открывается комбо-тиром (как в music.ts/createStemPlayer):
 * база (drums+bass+lead) всегда, chords/counter c x8, arp/fx c x16.
 */

type Role = Song['tracks'][number]['role'];
const ROLE_TIER: Record<Role, number> = {
  drums: 0, bass: 0, lead: 0,
  chords: 1, counter: 1,
  arp: 2, fx: 2,
};

/** Один подвешенный трек: свои ноты/ансамбль, снимается без затрагивания транспорта. */
export interface Stem {
  /** Текущий открытый тир слоёв для ЭТОГО трека. */
  setTier(tier: number): void;
  /** Глобальное транспортное время старта (сек) и конца звучания (+хвост). */
  readonly startSec: number;
  readonly endSec: number;
  /** Готов ли ансамбль (reverb-IR сгенерирован). */
  ready(): Promise<void>;
  /** Снять трек: освободить ноды. НЕ трогает общий транспорт. */
  retire(): void;
}

const BASE_BPM = 120; // номинальный темп транспорта; турбо поднимает его (time-stretch)

// --- кэш reverb-IR: каждый Tone.Reverb рендерит свой impulse через OfflineContext
// (~150мс главного потока). Для одинаковых decay/preDelay IR идентичен, но
// midi-движок плодит новый Reverb на каждый трек → повторный рендер = фриз →
// планировщик Tone глохнет → хрип на стыке. Патчим generate() ОДИН раз: при
// совпадении параметров переиспользуем готовый AudioBuffer (он иммутабелен,
// делится между ConvolverNode безопасно). Делаем в нашем коде, не в vendor —
// переживает пересинк midi-gen. Защищено try/catch: при иных внутренностях Tone
// падаем на оригинал.
(() => {
  type RevProto = { generate: () => Promise<unknown> };
  const proto = (Tone as unknown as { Reverb?: { prototype: RevProto } }).Reverb?.prototype;
  if (!proto || (proto as { __irCached?: boolean }).__irCached) return;
  const orig = proto.generate;
  const cache = new Map<string, AudioBuffer>();
  proto.generate = function (this: Record<string, unknown>) {
    try {
      const conv = this._convolver as ConvolverNode | undefined;
      const ctx = this.context as { sampleRate?: number } | undefined;
      const key = `${this._decay}_${this._preDelay}_${ctx?.sampleRate}`;
      const hit = cache.get(key);
      if (conv && hit) {
        conv.buffer = hit;
        (this as { ready?: Promise<unknown> }).ready = Promise.resolve();
        return Promise.resolve(this);
      }
      return (orig.call(this) as Promise<unknown>).then((r) => {
        try { if (conv?.buffer) cache.set(key, conv.buffer); } catch { /* мимо */ }
        return r;
      });
    } catch {
      return orig.call(this); // внутренности Tone иные — на оригинал
    }
  };
  (proto as { __irCached?: boolean }).__irCached = true;
})();

export class Conductor {
  private transport = Tone.getTransport();
  // тиков на «песенную секунду» при базовом темпе. Часы/планирование ведём в
  // ТИКАХ (инвариант к темпу): подъём bpm ускоряет тики → музыка, блоки и машина
  // синхронно ускоряются, питч нот не меняется (высота задаётся отдельно).
  private tps = this.transport.PPQ * BASE_BPM / 60;
  private latCache = 0;
  private latCalls = 0;
  private started = false;
  private stems = new Set<{ parts: Tone.Part[]; autoIds: number[]; ensemble: ReturnType<typeof buildEnsemble> | null }>();
  // Лид-гид: трек-лид играем приглушённо (×leadGuide по velocity) — мелодию несёт
  // СБОР блоков («ты играешь музыку»). Игра двигает это по комбо: чисто играешь —
  // гид уходит в тень, твои перехваты = мелодия; сорвал комбо — гид возвращается
  // и ведёт. Дакаем ТОЛЬКО лид, остальной микс (барабаны/бас/гармония) полный.
  private leadGuide = 0.5;
  /** Уровень лид-гида 0..1: 1 — лид на полную, ~0.3 — тихий гид под сбором. */
  setLeadGuide(g: number) { this.leadGuide = Math.max(0.15, Math.min(1, g)); }

  /** Подвесить трек со сдвигом startOffsetSec по глобальному транспорту. */
  addStem(song: Song, startOffsetSec: number): Stem {
    const secPerTick = 60 / song.bpm / song.ppq;
    const durationSec = song.durationTicks * secPerTick;
    const TAIL = 1.5;
    let tier = 0;
    let ensemble: ReturnType<typeof buildEnsemble> | null = null;
    let parts: Tone.Part[] = [];
    let autoIds: number[] = [];
    const rec: {
      parts: Tone.Part[]; autoIds: number[];
      ensemble: ReturnType<typeof buildEnsemble> | null;
    } = { parts, autoIds, ensemble };
    this.stems.add(rec);

    // песенные секунды → абсолютные тики транспорта (от базового темпа).
    // планируем в тиках, чтобы момент срабатывания НЕ зависел от текущего bpm
    // (иначе JIT-стем, заведённый во время турбо, рассинхронился бы)
    const toTicks = (sec: number) => `${Math.round((startOffsetSec + sec) * this.tps)}i`;

    const build = () => {
      const t0 = performance.now(); // PERF-МЕТРИКА — НЕ УДАЛЯТЬ
      ensemble = buildEnsemble(song);
      console.warn(`[build] ensemble ${(performance.now() - t0).toFixed(1)}ms off=${startOffsetSec.toFixed(1)}`);
      ensemble.ready
        .then(() => console.warn(`[build] IR ready off=${startOffsetSec.toFixed(1)}`))
        .catch(() => { /* мимо */ });
      rec.ensemble = ensemble;
      // тот же приоритет ведущего голоса, что у генерации блоков (lead>counter>arp):
      // именно его дублирует сбор → именно его и дакаем как «гид».
      const leadIdx = (['lead', 'counter', 'arp'] as Role[])
        .map((r) => song.tracks.findIndex((t) => t.role === r))
        .find((idx) => idx >= 0) ?? -1;
      parts = song.tracks.map((track, i) => {
        const voice = ensemble!.voices[i];
        const roleTier = ROLE_TIER[track.role] ?? 0;
        const isLead = i === leadIdx;
        const events = track.notes.map((n) => ({
          time: toTicks(n.start * secPerTick), // абсолютный тик ноты
          pitch: n.pitch,
          dur: Math.max(0.02, n.dur * secPerTick), // длительность в реальных секундах
          vel: n.vel / 127,
          slide: n.slide,
        }));
        const part = new Tone.Part((time, ev) => {
          if (roleTier > tier) return; // слой ещё не открыт комбо
          // лид — приглушённым гидом (×leadGuide), мелодию несёт сбор блоков
          voice.trigger(ev.pitch, time, ev.dur, isLead ? ev.vel * this.leadGuide : ev.vel, ev.slide);
        }, events);
        part.start(0); // времена событий абсолютные (в тиках) → старт с тика 0
        return part;
      });
      rec.parts = parts;
      autoIds = ensemble.automations.map((a) =>
        this.transport.schedule((t) => a.apply(t), toTicks(a.time)));
      // анти-клип на стыке: новый трек стартует на полную поверх реверб-хвоста
      // прошлого → сумма клиппит = хрип. Кратко придушиваем мастер в момент
      // старта (сайдчейн-дак), восстанавливаем за ~1.2 с. Первый трек (offset 0)
      // не душим — хвоста ещё нет.
      if (startOffsetSec > 0.5) {
        autoIds.push(this.transport.scheduleOnce((time) => {
          const v = Tone.getDestination().volume;
          const base = v.value;
          v.cancelScheduledValues(time);
          v.setValueAtTime(base, time);
          v.linearRampToValueAtTime(base - 6, time + 0.04);
          v.linearRampToValueAtTime(base, time + 1.2);
        }, toTicks(0)));
      }
      rec.autoIds = autoIds;
    };
    build();

    return {
      startSec: startOffsetSec,
      endSec: startOffsetSec + durationSec + TAIL,
      setTier: (t) => { tier = t; },
      ready: async () => { await ensemble!.ready; },
      retire: () => {
        for (const id of autoIds) this.transport.clear(id);
        for (const p of parts) p.dispose();
        ensemble?.dispose();
        ensemble = null;
        rec.ensemble = null;
        rec.parts = [];
        this.stems.delete(rec);
      },
    };
  }

  /** Запустить транспорт один раз (после первого Tone.start()). */
  async start() {
    await Tone.start();
    if (this.started) return;
    this.started = true;
    this.transport.bpm.value = BASE_BPM; // базовый темп — турбо поднимает его
    this.transport.loop = false;
    this.transport.start();
  }

  pause() { this.transport.pause(); }
  resume() { this.transport.start(); }
  isPlaying() { return this.transport.state === 'started'; }

  /**
   * Турбо: множитель темпа (1 — норма). Поднимает bpm → тики идут быстрее →
   * музыка/блоки/машина синхронно ускоряются, питч тот же. Плавный рамп.
   */
  setRate(rate: number, dur = 0.3) {
    // два rampTo на один и тот же аудио-момент бросают «Start time must be
    // strictly greater…» (Tone). Защищаемся: рампим не чаще раза на ~16мс.
    const now = Tone.now();
    if (now <= this.lastRampT) return;
    this.lastRampT = now;
    try { this.transport.bpm.rampTo(BASE_BPM * rate, dur); }
    catch { /* гонка рампов — безопасно пропустить */ }
  }
  private lastRampT = -1;

  /**
   * Приглушить музыку (мастер-громкость) до db за dur секунд — для лиричного
   * финала, где музыка-драйв уступает место ночному амбиенту (ambient.ts идёт
   * мимо мастера, поэтому не глохнет вместе с музыкой). Сайдчейн-дак на стыках
   * работает относительно текущего уровня и эту рампу не ломает.
   */
  duckMusic(db: number, dur = 4) {
    try { Tone.getDestination().volume.rampTo(db, dur); }
    catch { /* безопасно пропустить */ }
  }

  /**
   * Глобальная позиция в ПЕСЕННЫХ секундах (тики/tps) — инвариант к темпу:
   * под турбо тики идут быстрее, песенное время растёт быстрее, всё синхронно.
   * Клок никогда не сбрасывается. Латентность вычитаем приближённо.
   */
  positionSec(): number {
    const ctx = Tone.getContext();
    const raw = ctx.rawContext as AudioContext;
    if (raw.state !== 'running') return 0;
    if (this.latCalls++ % 30 === 0) {
      this.latCache = ctx.lookAhead + (raw.outputLatency || raw.baseLatency || 0);
    }
    return Math.max(0, this.transport.ticks / this.tps - this.latCache);
  }

  dispose() {
    for (const rec of [...this.stems]) {
      for (const id of rec.autoIds) this.transport.clear(id);
      for (const p of rec.parts) p.dispose();
      rec.ensemble?.dispose();
    }
    this.stems.clear();
    this.transport.stop();
    this.transport.position = 0;
    this.transport.cancel();
    this.started = false;
  }
}
