declare const GENRE_IDS: readonly ["keygen", "noir", "anime", "phonk", "blues", "military", "darkacademia", "grime", "nightcore", "tune", "musicbox", "eurobeat", "outrun", "grimerun"];
type GenreId = (typeof GENRE_IDS)[number];
type Mode = 'major' | 'naturalMinor' | 'harmonicMinor' | 'dorian' | 'phrygian' | 'mixolydian' | 'blues' | 'minorPentatonic' | 'majorPentatonic';
type TrackRole = 'lead' | 'chords' | 'bass' | 'drums' | 'arp' | 'counter' | 'fx';
interface NoteEvent {
    /** MIDI pitch 0–127. */
    pitch: number;
    /** Start time in ticks (PPQ 480). */
    start: number;
    /** Duration in ticks, > 0. */
    dur: number;
    /** Velocity 1–127. */
    vel: number;
    /**
     * Tracker 3xx tone-portamento: the audio layer glides the already-sounding
     * voice to this pitch instead of retriggering. The generator must keep a
     * carrier note ringing through this note's span. MIDI export ignores it.
     */
    slide?: boolean;
}
interface Track {
    name: string;
    /** MIDI channel; drums are always 9. */
    channel: number;
    /** GM program number 0–127 (ignored for drums). */
    program: number;
    role: TrackRole;
    notes: NoteEvent[];
}
interface Section {
    name: string;
    startBar: number;
    bars: number;
    /**
     * Repeat variant for stretched (minutes > 0) songs: undefined = the
     * original pass, 1 = the alternate pass (A B A B form). Generators key
     * their per-section caches by `sectionKey`, so variant sections get fresh
     * material; arrange/audio keep using `name` (layers, velocity, filters).
     */
    variant?: number;
}
interface Song {
    code: string;
    /**
     * Genre-flavored track name, deterministic from the code. Drawn from its
     * own named PRNG stream — never affects the notes.
     */
    title: string;
    version: number;
    genre: GenreId;
    seed: bigint;
    ppq: 480;
    bpm: number;
    timeSig: [number, number];
    key: {
        tonic: number;
        mode: Mode;
    };
    /** 0..1 — offbeat shift already baked into note ticks. */
    swing: number;
    sections: Section[];
    tracks: Track[];
    durationTicks: number;
}
declare const PPQ: 480;
declare const DRUM_CHANNEL: 9;

export { DRUM_CHANNEL as D, type GenreId as G, type Mode as M, type NoteEvent as N, PPQ as P, type Song as S, type TrackRole as T, type Section as a, type Track as b, GENRE_IDS as c };
