import { G as GenreId, S as Song, M as Mode, T as TrackRole, a as Section, b as Track } from './types-GdXF28I4.js';
export { D as DRUM_CHANNEL, c as GENRE_IDS, N as NoteEvent, P as PPQ } from './types-GdXF28I4.js';

interface GenerateOptions {
    genre?: GenreId;
    seed?: bigint;
    /** Serial code; restores genre + seed + minutes. Explicit `genre`/`minutes` override the code's. */
    code?: string;
    /**
     * Approximate target length in minutes, integer 1–7. Stored in the code's
     * 3 flags bits, so the code alone restores the full-length song. Omit (or 0)
     * for the genre's natural form — identical to pre-feature behavior.
     */
    minutes?: number;
}
declare function generate(opts?: GenerateOptions): Song;

/**
 * Keygen-style serial codec: XXXX-XXXX-XXXX-XXXX (Crockford Base32).
 *
 * 80-bit payload, BigInt-packed, big-endian:
 *   version(4) | genre(5) | flags(3) | seed(60) | crc8(8)
 *
 * CRC-8 (poly 0x07) covers the first 72 bits and catches manual typos.
 * The genre is embedded, so a code alone fully restores a song — no DB.
 */

declare const CODE_VERSION = 1;
declare class CodeError extends Error {
    readonly reason: 'length' | 'charset' | 'checksum' | 'version' | 'genre';
    constructor(message: string, reason: 'length' | 'charset' | 'checksum' | 'version' | 'genre');
}
declare function encodeCode(genre: GenreId, seed: bigint, opts?: {
    version?: number;
    flags?: number;
}): string;
interface DecodedCode {
    version: number;
    genre: GenreId;
    flags: number;
    seed: bigint;
}
declare function normalizeCode(input: string): string;
declare function decodeCode(input: string): DecodedCode;
/**
 * Fresh entropy for NEW codes only — generation itself never calls this.
 * crypto is available in browsers, workers and Node ≥ 19.
 */
declare function randomSeed(): bigint;
/** Deterministic successor seed — endless playlist from one starting code. */
declare function nextSeed(seed: bigint): bigint;

/**
 * Song IR → Standard MIDI File bytes. Ticks map 1:1 (both sides are PPQ 480),
 * so the .mid is exactly what the player performs. Sections become markers.
 */
declare function songToMidi(song: Song): Uint8Array;

interface Rng {
    /** Uniform float in [0, 1). */
    next(): number;
    /** Uniform integer in [min, max], inclusive. */
    int(min: number, max: number): number;
    pick<T>(arr: readonly T[]): T;
    weighted<T>(items: ReadonlyArray<{
        w: number;
        v: T;
    }>): T;
    chance(p: number): boolean;
    /** Fisher–Yates; returns a new array. */
    shuffle<T>(arr: readonly T[]): T[];
}

type ChordQuality = 'diatonic' | 'maj' | 'min' | 'sus2' | 'sus4' | 'dom7' | 'min7' | 'maj7' | 'dim7' | 'halfDim7';
interface Chord {
    /** Root pitch class 0–11. */
    root: number;
    /** Pitch classes, root first. */
    pitchClasses: number[];
    /** 0-based scale degree the chord was built on. */
    degree: number;
}

interface ProgressionStep {
    /** 0-based scale degree (0 = tonic). */
    degree: number;
    /** Length in beats. */
    beats: number;
    seventh?: boolean;
    ninth?: boolean;
    quality?: ChordQuality;
}
type ProgressionTemplate = ProgressionStep[];

interface Weighted<T> {
    w: number;
    v: T;
}
/**
 * Genre-flavored track naming. Patterns hold `{slot}` tokens resolved from
 * `words`; a trailing digit ("{noun2}") reuses the bank but avoids repeating
 * a word already picked from it. Style (caps, ♥, .EXE) is encoded literally.
 */
interface NamingSpec {
    patterns: Weighted<string>[];
    words: Record<string, readonly string[]>;
}
interface SectionSpec {
    name: string;
    bars: number;
}
/** 16 steps per bar; value 0..1 is the accent (0 = no hit). */
interface StepPattern {
    name: string;
    kick: number[];
    snare: number[];
    hatClosed: number[];
    hatOpen?: number[];
    perc?: number[];
}
interface ChordSpan {
    chord: Chord;
    /** Ticks. */
    start: number;
    /** Ticks. */
    dur: number;
}
/** Everything a part generator needs. Built once per generate() call. */
interface GenContext {
    seed: bigint;
    cfg: GenreConfig;
    /** Memoized named PRNG streams — the only randomness source. */
    rng: (name: string) => Rng;
    bpm: number;
    timeSig: [number, number];
    key: {
        tonic: number;
        mode: Mode;
    };
    swing: number;
    sections: Section[];
    totalBars: number;
    barTicks: number;
    beatTicks: number;
    chords: ChordSpan[];
    chordAt: (tick: number) => Chord;
    /**
     * Cross-part scratchpad for genre hooks (e.g. phonk bass must duplicate the
     * kick pattern — drums write 'phonk.kicks', bass reads it). Generators run
     * in fixed order: drums → bass → chords → arp → melody.
     */
    shared: Map<string, unknown>;
}
type PartGenerator = (ctx: GenContext) => Track | null;
/** Tracker arp cycle shapes. 'thumb' alternates the root with every other tone. */
type ArpPattern = 'up' | 'down' | 'updown' | 'octaves' | 'thumb';
type BassStyle = 'synth8' | 'walking' | 'boogie' | 's808' | 'march' | 'sustain' | 'octave8' | 'syncopated16';
interface GenreConfig {
    id: GenreId;
    name: string;
    /** Track-title generator data — every genre must define its own flavor. */
    naming: NamingSpec;
    /** Kept generatable (codes keep working) but excluded from listGenres(). */
    hidden?: boolean;
    bpm: [number, number];
    /** Bimodal tempo (shanson: lyrical 80–95 vs kabak 115–125). Overrides `bpm` when set. */
    bpmLanes?: Weighted<[number, number]>[];
    timeSig: [number, number];
    keys: Weighted<number>[];
    modes: Weighted<Mode>[];
    swing: [number, number];
    structures: Weighted<SectionSpec[]>[];
    progressions: Weighted<ProgressionTemplate>[];
    /** Each section NAME gets a progression no other name already took (when possible). */
    distinctProgressions?: boolean;
    melody: {
        register: [number, number];
        /** 0..1 — how busy the rhythm is. */
        density: number;
        leapProb: number;
        restProb: number;
        /** 0..1 — weight of off-16th onsets. */
        syncopation: number;
        /** Melody walks this scale instead of the key mode (blues over dom7 harmony). */
        scale?: Mode;
    };
    bass: {
        style: BassStyle;
        /** Per-seed style pool; overrides `style` when set. */
        styles?: Weighted<BassStyle>[];
        register: [number, number];
    };
    /** Tracker-style arpeggio voice (keygen and friends). */
    arp?: {
        register: [number, number];
        /** Notes per beat: 4 = 16ths, 8 = 32nds. */
        rate: 4 | 8;
        /** Cycle shape pool, picked once per section name. Missing = 'up'. */
        patterns?: Weighted<ArpPattern>[];
    };
    comping?: {
        register: [number, number];
        /** sustained pads (default) | short on-beat stabs (brass) | Alberti broken chords. */
        style?: 'sustained' | 'stabs' | 'alberti';
    };
    drums: {
        patterns: Weighted<StepPattern>[];
        /** A fill lands every N bars (and on the last bar of a section). */
        fillEvery: number;
        /** Per-bar probability of a 1/32 hat-roll burst (trap/phonk). */
        rollProb?: number;
        /** Fill flavour: tom/snare 16ths (default) or tracker snare-rush 32nds. */
        fillStyle?: 'toms' | 'rush' | 'mixed';
    };
    instruments: Partial<Record<TrackRole, {
        program: number;
        name: string;
    }>>;
    arrange: {
        /** Section name → active roles; missing name = all roles. */
        layers: Record<string, TrackRole[] | 'all'>;
        sectionVelocity?: Record<string, number>;
    };
    humanize: {
        /** Max timing jitter in ticks. */
        timingTicks: number;
        /** Max velocity jitter as a fraction (0.1 = ±10%). */
        velocity: number;
    };
    /**
     * Declarative low-pass automation, interpreted by the audio layer.
     * Sections not listed sit at `open`. Pure data — core stays Tone-free.
     */
    filterAutomation?: {
        /** Whose cutoff to drive; 'master' inserts a filter on the master bus. */
        target: 'lead' | 'arp' | 'master';
        /** Fully-open cutoff in Hz. */
        open: number;
        sections: Record<string, {
            move: 'closed';
            hz: number;
        } | {
            move: 'sweep';
            fromHz: number;
        }>;
    };
    /** Genre-specific overrides for the default part generators. */
    hooks?: Partial<Record<'melody' | 'bass' | 'drums' | 'comping' | 'arp', PartGenerator>>;
}

declare function getGenre(id: GenreId): GenreConfig;
interface GenreInfo {
    id: GenreId;
    name: string;
    bpm: [number, number];
}
declare function listGenres(): GenreInfo[];

export { CODE_VERSION, CodeError, type DecodedCode, type GenerateOptions, GenreId, type GenreInfo, Mode, Section, Song, Track, TrackRole, decodeCode, encodeCode, generate, getGenre, listGenres, nextSeed, normalizeCode, randomSeed, songToMidi };
