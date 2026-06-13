import * as THREE from 'three';
import type { Song } from 'midi-gen/core';
import type { Conductor, Stem } from '../conductor';
import { buildLevel, type Level } from './level';
import { makeRoad, type Road } from './road';
import { Blocks, type Difficulty, type BlockExtras } from './blocks';
import { Traffic } from './traffic';

/**
 * Бесконечная трасса: цепочка трек-сегментов, сваренных встык в ОДНОМ
 * глобальном пространстве (дистанция/время). Каждый уровень начинается и
 * кончается в (x=0, h=0) (см. сварку в level.ts), поэтому стык — без шва:
 * следующий сегмент стартует из тех же нулей. Геометрия и тайминги — кусочные
 * функции, диспатчат к сегменту по глобальной координате.
 *
 * Блоки/трафик у каждого сегмента свои (позиции запечены в конструкторе в
 * локальных координатах) — сегмент сдвигаем в мир сдвигом mesh.position.z, а
 * обновляем локальными carDist/time при общем мировом carX. Так Blocks/Traffic
 * переиспользуются как есть. Аудио каждого сегмента подвешено на Conductor со
 * сдвигом tOffset — транспорт непрерывен, музыка перетекает по хвостам релизов.
 */

export interface Segment {
  song: Song;
  level: Level;
  geoLevel: Level; // геометрия глобальной дороги (для рантайм-позиций трафика)
  blocks: Blocks;
  traffic: Traffic;
  stem: Stem | null; // аудио заводится JIT (~AUDIO_LEAD до нот) и снимается после хвоста
  stemDone: boolean; // стем уже отыграл и снят — НЕ воскрешать (иначе залп пересборок)
  distOffset: number; // глобальная дистанция начала сегмента, м
  tOffset: number; // глобальное транспортное время начала, сек
  distEnd: number; // distOffset + level.totalDist
  tEnd: number; // tOffset + level.durationSec
  retired: boolean;
}

// сегмент подвешиваем сильно заранее: мир строит чанки на ~780 м вперёд, и
// геометрия за стыком должна уже существовать, иначе дорога впереди «плоская»
// и не перестроится (чанк впереди не рециклится). 900 м — с запасом.
const APPEND_AHEAD = 900;
// снимаем сегмент, когда машина ушла далеко вперёд и его звук дозвучал
const RETIRE_BEHIND = 140;
// аудио заводим заранее, «на подъезде» — чтобы ансамбль+reverb-IR успели
// построиться/прогреться задолго до старта нот, без догрузки на лету (хрип).
// JIT всё равно держит максимум 2 ансамбля разом (3-й не появляется).
const AUDIO_LEAD = 16;

export class EndlessChain implements Level {
  // Level-интерфейс: бесконечность — финиша/HUD-таймера в этом режиме нет
  readonly durationSec = Number.POSITIVE_INFINITY;
  readonly totalDist = Number.POSITIVE_INFINITY;

  private segments: Segment[] = [];
  private pending = false; // идёт асинхронная сборка следующего сегмента
  private goldDrought = 0;
  // одна непрерывная дорога на всю сессию — геометрия без швов между треками
  private road: Road = makeRoad(Math.floor(Math.random() * 1e9));
  /** Колбэк на завершённый сегмент (для тикера/наград): индекс и трек. */
  onSegmentDone?: (seg: Segment) => void;

  constructor(
    private scene: THREE.Scene,
    private conductor: Conductor,
    private diff: Difficulty,
    private nextSong: () => Promise<Song>,
  ) {}

  /** Первый сегмент — синхронно, аудио сразу (нужно до старта транспорта). */
  pushFirst(song: Song): Segment {
    const seg = this.append(song);
    this.ensureStem(seg);
    return seg;
  }

  /** Создать аудио-стем сегмента (just-in-time, ~AUDIO_LEAD до его нот). */
  private ensureStem(seg: Segment) {
    if (seg.stem) return;
    seg.stem = this.conductor.addStem(seg.song, seg.tOffset);
    seg.stem.ready().catch(() => { /* IR не успел — мимо, дозвучит */ });
  }

  private extras(): BlockExtras {
    const gold = this.goldDrought >= 2 || Math.random() < 0.45;
    this.goldDrought = gold ? 0 : this.goldDrought + 1;
    return { gold, mystery: 2 };
  }

  private append(song: Song): Segment {
    const prev = this.segments[this.segments.length - 1];
    const distOffset = prev ? prev.distEnd : 0;
    const tOffset = prev ? prev.tEnd : 0;
    const _t0 = performance.now(); // PERF-МЕТРИКА — НЕ УДАЛЯТЬ
    const level = buildLevel(song);
    const _tLevel = performance.now() - _t0;
    // блокам/трафику даём геометрию ГЛОБАЛЬНОЙ дороги (со сдвигом сегмента), а
    // тайминги (distAt/speedAt) — из пер-песенной симуляции. Так позиции блоков
    // ложатся ровно на ту же дорогу, что и машина — без шва.
    const geoLevel: Level = {
      durationSec: level.durationSec, totalDist: level.totalDist,
      distAt: level.distAt, speedAt: level.speedAt, energyAt: level.energyAt,
      curveAt: (d) => this.road.curveAt(distOffset + d),
      heightAt: (d) => this.road.heightAt(distOffset + d),
    };
    const _tb = performance.now();
    const blocks = new Blocks(song, geoLevel, this.diff, this.extras());
    const _tBlocks = performance.now() - _tb;
    const _tt = performance.now();
    const traffic = new Traffic(geoLevel, blocks, this.diff);
    const _tTraffic = performance.now() - _tt;
    console.warn(`[append] level=${_tLevel.toFixed(1)}ms blocks=${_tBlocks.toFixed(1)}ms `
      + `traffic=${_tTraffic.toFixed(1)}ms total=${(performance.now() - _t0).toFixed(1)}ms`);
    blocks.mesh.position.z = -distOffset; // сдвиг сегмента в мир по дистанции
    traffic.root.position.z = -distOffset;
    this.scene.add(blocks.mesh, traffic.root);
    const seg: Segment = {
      song, level, geoLevel, blocks, traffic, stem: null, stemDone: false, // аудио — JIT в update()
      distOffset, tOffset,
      // distEnd = ровно distAt(durationSec), а не totalDist (sArr[last]): иначе
      // на стыке стык дистанций расходится на ~2 м (off-by-one сэмплера) → лёгкий рывок
      distEnd: distOffset + level.distAt(level.durationSec),
      tEnd: tOffset + level.durationSec,
      retired: false,
    };
    this.segments.push(seg);
    return seg;
  }

  /** Готовность аудио первого сегмента (reverb-IR) — ждём до старта. */
  async readyFirst(): Promise<void> {
    await this.segments[0]?.stem?.ready();
  }

  /** Активные (не снятые) сегменты — Game обходит их для блоков/трафика. */
  active(): Segment[] {
    return this.segments.filter((s) => !s.retired);
  }

  /** Подвесить следующий, завести/снять аудио, снять отъехавшие. Каждый кадр. */
  update(globalDist: number, globalT: number) {
    const last = this.segments[this.segments.length - 1];
    // ГЕОМЕТРИЮ подвешиваем рано (мир строит чанки вперёд)
    if (last && !this.pending && last.distEnd - globalDist < APPEND_AHEAD) {
      this.pending = true;
      this.nextSong().then((song) => {
        this.append(song);
        this.pending = false;
      }).catch(() => { this.pending = false; });
    }
    for (const seg of this.segments) {
      if (seg.retired) continue;
      // АУДИО заводим РОВНО раз, заранее (JIT), только для ПРЕДСТОЯЩЕГО сегмента.
      // !stemDone — не воскрешать отыгравший (иначе на стыке шёл залп пересборок
      // ансамбля → ~200мс фризы → планировщик Tone глох → хрип).
      if (!seg.stem && !seg.stemDone && seg.tOffset - globalT < AUDIO_LEAD && globalT < seg.tOffset + 1) {
        this.ensureStem(seg);
      }
      // снять аудио сразу после хвоста — освободить CPU, пометить как отыгравший
      if (seg.stem && globalT > seg.stem.endSec) {
        seg.stem.retire(); seg.stem = null; seg.stemDone = true;
      }
      // снять отъехавшую геометрию (машина далеко впереди)
      if (seg.distEnd < globalDist - RETIRE_BEHIND && seg !== last) {
        seg.retired = true;
        this.scene.remove(seg.blocks.mesh, seg.traffic.root);
        seg.blocks.dispose();
        seg.traffic.dispose();
        seg.stem?.retire();
        seg.stem = null;
        seg.stemDone = true;
        this.onSegmentDone?.(seg);
      }
    }
  }

  /** Тир музыкальных слоёв — применяем ко всем звучащим трекам (у кого есть аудио). */
  setTier(tier: number) {
    for (const s of this.active()) s.stem?.setTier(tier);
  }

  /** DDA: плотность блоков и интенсивность трафика — на все активные сегменты. */
  setDensity(d: number) { for (const s of this.active()) s.blocks.setDensity(d); }
  setIntensity(x: number) { for (const s of this.active()) s.traffic.setIntensity(x); }

  /** BPM трека, звучащего в момент t — для бит-пульса блума. */
  bpmAt(t: number): number {
    const s = this.segAtTime(t);
    return s ? s.song.bpm : (this.segments[0]?.song.bpm ?? 120);
  }

  /** Прогресс [0..1] внутри текущего трека — для финальной эскалации/климакса. */
  localFrac(t: number): number {
    const s = this.segAtTime(t);
    if (!s) return 0;
    return Math.max(0, Math.min(1, (t - s.tOffset) / s.level.durationSec));
  }

  /** Секунд от начала текущего трека — для «интро не молчит». */
  localSec(t: number): number {
    const s = this.segAtTime(t);
    return s ? t - s.tOffset : 0;
  }

  /** Наибольший конец трека (стык) ≤ t — для разовой церемонии финиша. */
  lastSeamBefore(t: number): number {
    let best = 0;
    for (const s of this.segments) if (s.tEnd <= t && s.tEnd > best) best = s.tEnd;
    return best;
  }

  private segAtTime(t: number): Segment | null {
    for (const s of this.segments) {
      if (t >= s.tOffset && t < s.tEnd) return s;
    }
    return null;
  }

  // --- Level-интерфейс: кусочные функции в глобальных координатах --------

  distAt(t: number): number {
    const s = this.segAtTime(t);
    if (s) return s.distOffset + s.level.distAt(t - s.tOffset);
    // до первого / после последнего (next ещё не подвешен) — экстраполяция
    const last = this.segments[this.segments.length - 1];
    if (last && t >= last.tEnd) {
      return last.distEnd + last.level.speedAt(last.level.durationSec) * (t - last.tEnd);
    }
    return 0;
  }

  speedAt(t: number): number {
    const s = this.segAtTime(t);
    if (s) return s.level.speedAt(t - s.tOffset);
    const last = this.segments[this.segments.length - 1];
    if (last) return last.level.speedAt(Math.min(t - last.tOffset, last.level.durationSec));
    return 25;
  }

  // геометрия — глобальная непрерывная дорога (одна на сессию), без швов
  heightAt(d: number): number { return this.road.heightAt(d); }
  curveAt(d: number): number { return this.road.curveAt(d); }

  /** Жанр трека, звучащего в момент t — для подписи на стыке. */
  genreAt(t: number): string {
    const s = this.segAtTime(t);
    return s ? s.song.genre : '';
  }

  /** Энергия секции текущего трека (0..1) — для динамики света (#39). */
  energyAt(t: number): number {
    const s = this.segAtTime(t);
    return s ? s.level.energyAt(t - s.tOffset) : 0.5;
  }

  dispose() {
    for (const seg of this.segments) {
      if (seg.retired) continue;
      this.scene.remove(seg.blocks.mesh, seg.traffic.root);
      seg.blocks.dispose();
      seg.traffic.dispose();
      seg.stem?.retire();
    }
    this.segments = [];
  }
}
