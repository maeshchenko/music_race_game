import { S as Song } from './types-GdXF28I4.js';
import * as Tone from 'tone';

interface Player {
    play(): Promise<void>;
    stop(): void;
    isPlaying(): boolean;
    positionSec(): number;
    /** Exact loop length (one pass of the song). */
    durationSec: number;
    setLoop(on: boolean): void;
    looping(): boolean;
    /** Called when playback ends (non-loop mode only). */
    onEnded?: () => void;
    dispose(): void;
}
/**
 * Live playback on the shared Tone Transport. Note ticks are converted to
 * seconds here — the Transport's own BPM/PPQ are not used, so what you hear
 * is exactly the IR (and exactly what MIDI export will contain).
 *
 * Songs are composed as seamless loops; looping is ON by default. The loop
 * point sits exactly at durationTicks — synth releases and delay tails ring
 * over the seam, which is what makes it sound continuous.
 */
declare function createPlayer(song: Song, opts?: {
    loop?: boolean;
}): Player;

/**
 * Tone.js voices for song tracks. Pure synthesis — no samples, no network.
 *
 * Nodes are created against the CURRENT Tone context: call buildEnsemble()
 * live for playback, or inside Tone.Offline() for rendering — same code path
 * (that's the whole reason this is a factory).
 */

interface Voice {
    trigger(pitch: number, timeSec: number, durSec: number, velocity: number, slide?: boolean): void;
    dispose(): void;
    /** Exposed low-pass cutoff for section automation (phonk intro/build-up). */
    cutoff?: Tone.Signal<'frequency'>;
    /** Async insert FX (per-voice reverb IR) — awaited before offline render. */
    ready?: Promise<unknown>;
}
interface EnsembleAutomation {
    /** Transport-relative seconds. */
    time: number;
    apply(audioTime: number): void;
}
interface Ensemble {
    voices: Voice[];
    /** Section-driven FX moves (phonk filter sweeps) — player schedules these. */
    automations: EnsembleAutomation[];
    /** Resolves when async FX (reverb IR generation) are ready — offline render must await this. */
    ready: Promise<unknown>;
    dispose(): void;
}
declare function buildEnsemble(song: Song): Ensemble;

/**
 * Render a song to a PCM buffer with Tone.Offline. The SAME buildEnsemble()
 * runs here as in live playback — Tone swaps the global context inside the
 * callback, so the graph builds against the offline context for free.
 */
declare function renderSong(song: Song): Promise<AudioBuffer>;

/** AudioBuffer → 16-bit PCM WAV blob. */
declare function audioBufferToWav(buffer: AudioBuffer): Blob;

/**
 * midi-gen/audio — browser playback and rendering on Tone.js.
 *
 * Note: renderToMp3 is NOT exported here — its Web Worker is wired through
 * Vite's `new URL` asset handling and only works inside the app build. Games
 * embedding the library get live playback + WAV; MP3 stays an app feature.
 */

/** Render a song offline and pack it as a WAV blob. */
declare function renderToWav(song: Song): Promise<Blob>;

export { type Ensemble, type EnsembleAutomation, type Player, type Voice, audioBufferToWav, buildEnsemble, createPlayer, renderSong, renderToWav };
