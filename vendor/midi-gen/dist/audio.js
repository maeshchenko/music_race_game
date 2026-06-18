import {
  GM_DRUMS,
  PPQ,
  getGenre
} from "./chunk-YYIEHPBL.js";

// src/audio/offline.ts
import * as Tone2 from "tone";

// src/audio/instruments.ts
import * as Tone from "tone";

// src/audio/samples.ts
function resolveSampleBase(baseUrl) {
  const base = import.meta.env?.BASE_URL ?? "/";
  return base.replace(/\/$/, "") + baseUrl;
}
var SAMPLE_SETS = {
  electricGuitar: {
    baseUrl: "/samples/guitar-electric/",
    urls: { E2: "E2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3", C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3", C4: "C4.mp3" },
    volumeDb: -12,
    release: 0.35,
    distortion: 0.62,
    cab: { hp: 95, lp: 5200 },
    // 4x12 cab sim — kills the fizz
    doubleTrack: true,
    palmMute: true
  },
  electricBass: {
    baseUrl: "/samples/bass-electric/",
    urls: { E1: "E1.mp3", G1: "G1.mp3", "A#1": "As1.mp3", "C#2": "Cs2.mp3", E2: "E2.mp3", G2: "G2.mp3", "A#2": "As2.mp3", "C#3": "Cs3.mp3" },
    volumeDb: -6,
    release: 0.3,
    distortion: 0.16,
    cab: { hp: 40, lp: 3200 },
    // bass cab — round, no fizz
    monophonic: true
  },
  strings: {
    baseUrl: "/samples/violin/",
    urls: { G3: "G3.mp3", C4: "C4.mp3", E4: "E4.mp3", G4: "G4.mp3", C5: "C5.mp3", E5: "E5.mp3", G5: "G5.mp3", C6: "C6.mp3", E6: "E6.mp3", G6: "G6.mp3", C7: "C7.mp3" },
    volumeDb: -13,
    release: 0.8,
    attack: 0.25,
    vibrato: { rate: 5.2, depth: 0.12 }
  },
  violin: {
    baseUrl: "/samples/violin/",
    urls: { G3: "G3.mp3", C4: "C4.mp3", E4: "E4.mp3", G4: "G4.mp3", C5: "C5.mp3", E5: "E5.mp3", G5: "G5.mp3", C6: "C6.mp3", A6: "A6.mp3", E6: "E6.mp3", G6: "G6.mp3", C7: "C7.mp3" },
    volumeDb: -9,
    release: 0.5,
    attack: 0.05,
    vibrato: { rate: 5.8, depth: 0.16 }
  },
  // Upright/double bass (noir walking bass) — warm, woody, monophonic.
  contrabass: {
    baseUrl: "/samples/contrabass/",
    urls: { G1: "G1.mp3", "A#1": "As1.mp3", C2: "C2.mp3", D2: "D2.mp3", E2: "E2.mp3", "G#2": "Gs2.mp3", A2: "A2.mp3", "C#3": "Cs3.mp3", E3: "E3.mp3", "G#3": "Gs3.mp3", B3: "B3.mp3" },
    volumeDb: -7,
    release: 0.35,
    attack: 0.01,
    monophonic: true
  },
  // Bowed cello (dark academia bass / chamber). Low register is densely sampled
  // (≈whole-tone) so notes aren't repitched far — wide stretch on a low string
  // sounds rubbery/detuned. Vibrato kept subtle so sustained low notes don't wobble.
  cello: {
    baseUrl: "/samples/cello/",
    urls: {
      C2: "C2.mp3",
      D2: "D2.mp3",
      "D#2": "Ds2.mp3",
      E2: "E2.mp3",
      F2: "F2.mp3",
      G2: "G2.mp3",
      A2: "A2.mp3",
      B2: "B2.mp3",
      C3: "C3.mp3",
      D3: "D3.mp3",
      E3: "E3.mp3",
      F3: "F3.mp3",
      G3: "G3.mp3",
      A3: "A3.mp3",
      B3: "B3.mp3",
      C4: "C4.mp3",
      E4: "E4.mp3",
      G4: "G4.mp3",
      C5: "C5.mp3"
    },
    volumeDb: -9,
    release: 0.6,
    attack: 0.12,
    vibrato: { rate: 5, depth: 0.04 }
  },
  // Muted (harmon) trumpet — trumpet samples through a nasal mid-band "mute".
  mutedTrumpet: {
    baseUrl: "/samples/trumpet/",
    urls: { A3: "A3.mp3", C4: "C4.mp3", "D#4": "Ds4.mp3", F4: "F4.mp3", G4: "G4.mp3", "A#4": "As4.mp3", D5: "D5.mp3", F5: "F5.mp3", A5: "A5.mp3", C6: "C6.mp3" },
    volumeDb: -11,
    release: 0.25,
    attack: 0.02,
    cab: { hp: 520, lp: 3400 },
    // harmon-mute nasal honk
    vibrato: { rate: 5, depth: 0.07 }
  },
  // Vibraphone (noir comping) — soft mallets, long metallic ring.
  vibraphone: {
    baseUrl: "/samples/vibraphone/",
    urls: { C3: "C3.mp3", E3: "E3.mp3", G3: "G3.mp3", B3: "B3.mp3", D4: "D4.mp3", F4: "F4.mp3", A4: "A4.mp3", C5: "C5.mp3", E5: "E5.mp3" },
    volumeDb: -10,
    release: 1.2,
    attack: 0
  }
};
var REAL_PROGRAM_MAP = {
  30: "electricGuitar",
  34: "electricBass",
  48: "strings",
  40: "violin",
  32: "contrabass",
  // upright bass (noir)
  42: "cello",
  // bowed cello (dark academia)
  59: "mutedTrumpet",
  // noir soloist
  11: "vibraphone"
  // noir comping
  // program 6 (harpsichord, dark academia) has no CC sample source → stays synth
};
var L = (vMax, ...rr) => ({ vMax, rr });
var REAL_DRUM_KITS = {
  nightcorerun: {
    baseUrl: "/samples/drums/metal/",
    lanes: {
      kick: { layers: [
        L(0.5, "kick_l0_r0.mp3", "kick_l0_r1.mp3"),
        L(0.8, "kick_l1_r0.mp3", "kick_l1_r1.mp3"),
        L(1, "kick_l2_r0.mp3", "kick_l2_r1.mp3")
      ] },
      snare: { layers: [
        L(0.5, "snare_l0_r0.mp3", "snare_l0_r1.mp3"),
        L(0.8, "snare_l1_r0.mp3", "snare_l1_r1.mp3"),
        L(1, "snare_l2_r0.mp3", "snare_l2_r1.mp3")
      ] },
      hatClosed: { layers: [
        L(0.45, "hatClosed_l0_r0.mp3", "hatClosed_l0_r1.mp3"),
        L(0.75, "hatClosed_l1_r0.mp3", "hatClosed_l1_r1.mp3"),
        L(1, "hatClosed_l2_r0.mp3", "hatClosed_l2_r1.mp3")
      ] },
      hatOpen: { layers: [L(1, "hatOpen_l0_r0.mp3", "hatOpen_l0_r1.mp3")] },
      crash: { layers: [
        L(0.35, "crash_l0_r0.mp3"),
        L(0.6, "crash_l1_r0.mp3"),
        L(0.85, "crash_l2_r0.mp3"),
        L(1, "crash_l3_r0.mp3")
      ] },
      tomHigh: { layers: [
        L(0.6, "tomHigh_l0_r0.mp3", "tomHigh_l0_r1.mp3"),
        L(1, "tomHigh_l1_r0.mp3", "tomHigh_l1_r1.mp3")
      ] },
      tomLow: { layers: [
        L(0.6, "tomLow_l0_r0.mp3", "tomLow_l0_r1.mp3"),
        L(1, "tomLow_l1_r0.mp3", "tomLow_l1_r1.mp3")
      ] },
      clap: { layers: [L(1, "clap_l0_r0.mp3", "clap_l0_r1.mp3", "clap_l0_r2.mp3", "clap_l0_r3.mp3")] }
    }
  }
};

// src/audio/instruments.ts
var midiHz = (pitch) => 440 * 2 ** ((pitch - 69) / 12);
function makeChorus(depth = 0.7, rate = 0.8) {
  const ch = new Tone.Chorus(rate, 3.5, depth);
  ch.wet.value = 0.5;
  return ch.start();
}
function monoGuard(trigger) {
  let last = -1;
  return (p, t, d, v) => {
    if (t <= last + 2e-3) t = last + 2e-3;
    last = t;
    trigger(p, t, d, v);
  };
}
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function makeSquareLead(out, bpm) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "square" },
    envelope: { attack: 5e-3, decay: 0.08, sustain: 0.55, release: 0.08 },
    filter: { type: "lowpass", Q: 1 },
    filterEnvelope: { attack: 5e-3, decay: 0.12, sustain: 0.7, release: 0.1, baseFrequency: 900, octaves: 2.5 }
  });
  synth.volume.value = -4;
  const vibrato = new Tone.Vibrato(5.5, 0.12);
  const delay = new Tone.FeedbackDelay(60 / bpm * 0.75, 0.35);
  delay.wet.value = 0.28;
  synth.chain(vibrato, delay, out);
  const attack = monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v));
  return {
    trigger: (p, t, d, v, slide) => {
      if (slide) {
        synth.portamento = 0.06;
        synth.setNote(midiHz(p), t);
        synth.portamento = 0;
        return;
      }
      attack(p, t, d, v);
    },
    dispose: () => {
      synth.dispose();
      vibrato.dispose();
      delay.dispose();
    }
  };
}
function makeSawArp(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 2e-3, decay: 0.05, sustain: 0.3, release: 0.04 }
  });
  synth.volume.value = -14;
  const filter = new Tone.Filter(4500, "lowpass");
  synth.chain(filter, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v * 0.8),
    cutoff: filter.frequency,
    dispose: () => {
      synth.dispose();
      filter.dispose();
    }
  };
}
function makeSynthBass(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 4e-3, decay: 0.12, sustain: 0.5, release: 0.08 },
    filter: { type: "lowpass", Q: 2 },
    filterEnvelope: { attack: 4e-3, decay: 0.15, sustain: 0.4, release: 0.1, baseFrequency: 250, octaves: 2 }
  });
  synth.volume.value = -6;
  synth.connect(out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => synth.dispose()
  };
}
function makeCowbellLead(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "square" },
    envelope: { attack: 1e-3, decay: 0.18, sustain: 0.03, release: 0.06 }
  });
  synth.volume.value = -6;
  const band = new Tone.Filter({ frequency: 1100, type: "bandpass", Q: 1.2 });
  const dist = new Tone.Distortion(0.35);
  synth.chain(band, dist, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), Math.max(0.12, d), t, v),
    dispose: () => {
      synth.dispose();
      band.dispose();
      dist.dispose();
    }
  };
}
function makePhonkCowbell(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "square" },
    envelope: { attack: 1e-3, decay: 0.15, sustain: 0, release: 0.04 }
  });
  synth.volume.value = -5;
  const crush = new Tone.BitCrusher(10);
  crush.wet.value = 0.5;
  const band = new Tone.Filter({ frequency: 950, type: "bandpass", Q: 1 });
  const lowpass = new Tone.Filter(9e3, "lowpass");
  const dist = new Tone.Distortion(0.4);
  synth.chain(crush, band, lowpass, dist, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), Math.max(0.1, d), t, v),
    cutoff: lowpass.frequency,
    dispose: () => {
      synth.dispose();
      crush.dispose();
      band.dispose();
      lowpass.dispose();
      dist.dispose();
    }
  };
}
function makeBass808(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sine" },
    portamento: 0.08,
    envelope: { attack: 5e-3, decay: 0.4, sustain: 0.85, release: 0.12 },
    filter: { type: "lowpass", Q: 0.5 },
    filterEnvelope: { attack: 5e-3, decay: 0.2, sustain: 1, release: 0.1, baseFrequency: 350, octaves: 0.5 }
  });
  synth.volume.value = -2;
  const dist = new Tone.Distortion(0.45);
  dist.wet.value = 0.33;
  synth.chain(dist, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      dist.dispose();
    }
  };
}
function makeMutedTrumpet(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    portamento: 0.045,
    // wide intervals smear into a short gliss/bend
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.7, release: 0.25 },
    filter: { type: "lowpass", Q: 3 },
    filterEnvelope: { attack: 0.06, decay: 0.25, sustain: 0.5, release: 0.25, baseFrequency: 650, octaves: 1.2 }
  });
  synth.volume.value = -10;
  const vibrato = new Tone.Vibrato(4.5, 0.09);
  synth.chain(vibrato, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      vibrato.dispose();
    }
  };
}
function makeUprightBass(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.012, decay: 0.3, sustain: 0.35, release: 0.25 },
    filter: { type: "lowpass", Q: 0.8 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.4, release: 0.2, baseFrequency: 420, octaves: 0.8 }
  });
  synth.volume.value = -4;
  synth.connect(out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => synth.dispose()
  };
}
function makeMusicBox(out) {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 5,
    modulationIndex: 9,
    envelope: { attack: 2e-3, decay: 1.8, sustain: 0, release: 1.2 },
    modulationEnvelope: { attack: 1e-3, decay: 0.35, sustain: 0, release: 0.2 }
  });
  synth.volume.value = -10;
  const shimmer = new Tone.Reverb({ decay: 1.6, wet: 0.22 });
  synth.chain(shimmer, out);
  return {
    // Envelope has no sustain — the tine rings by itself; ignore short durs.
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), Math.max(1.2, d), t, v),
    ready: shimmer.ready,
    dispose: () => {
      synth.dispose();
      shimmer.dispose();
    }
  };
}
function makeVibraphone(out) {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 4,
    modulationIndex: 1.4,
    envelope: { attack: 4e-3, decay: 1.4, sustain: 0, release: 0.9 },
    modulationEnvelope: { attack: 2e-3, decay: 0.3, sustain: 0, release: 0.3 }
  });
  synth.volume.value = -7;
  const tremolo = new Tone.Tremolo(4, 0.35).start();
  synth.chain(tremolo, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), Math.max(0.8, d), t, v),
    dispose: () => {
      synth.dispose();
      tremolo.dispose();
    }
  };
}
function makeDarkPad(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.6, decay: 0.4, sustain: 0.7, release: 1.4 }
  });
  synth.volume.value = -18;
  const filter = new Tone.Filter(850, "lowpass");
  synth.chain(filter, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => {
      synth.dispose();
      filter.dispose();
    }
  };
}
function makePiano(out) {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 9,
    envelope: { attack: 2e-3, decay: 1.1, sustain: 0.12, release: 0.5 },
    modulationEnvelope: { attack: 2e-3, decay: 0.25, sustain: 0, release: 0.2 }
  });
  synth.volume.value = -8;
  synth.connect(out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => synth.dispose()
  };
}
function makeStrings(out, solo) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: solo ? 0.08 : 0.35, decay: 0.3, sustain: 0.8, release: solo ? 0.3 : 0.9 }
  });
  synth.volume.value = solo ? -4 : -16;
  const filter = new Tone.Filter(solo ? 3200 : 2200, "lowpass");
  const vibrato = new Tone.Vibrato(5, solo ? 0.15 : 0.06);
  synth.chain(filter, vibrato, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => {
      synth.dispose();
      filter.dispose();
      vibrato.dispose();
    }
  };
}
function makeHarmonica(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.03, decay: 0.1, sustain: 0.85, release: 0.12 },
    filter: { type: "bandpass", Q: 2 },
    filterEnvelope: { attack: 0.03, decay: 0.1, sustain: 0.9, release: 0.1, baseFrequency: 1500, octaves: 0.5 }
  });
  synth.volume.value = -7;
  const vibrato = new Tone.Vibrato(5.5, 0.2);
  synth.chain(vibrato, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      vibrato.dispose();
    }
  };
}
function makeTrumpet(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.03, decay: 0.1, sustain: 0.8, release: 0.12 },
    filter: { type: "lowpass", Q: 1.5 },
    filterEnvelope: { attack: 0.04, decay: 0.15, sustain: 0.7, release: 0.15, baseFrequency: 1200, octaves: 1.3 }
  });
  synth.volume.value = -5;
  synth.connect(out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => synth.dispose()
  };
}
function makeBrassSection(out) {
  const synth = new Tone.PolySynth(Tone.AMSynth, {
    harmonicity: 2,
    envelope: { attack: 0.04, decay: 0.15, sustain: 0.7, release: 0.15 }
  });
  synth.volume.value = -12;
  const filter = new Tone.Filter(2600, "lowpass");
  synth.chain(filter, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => {
      synth.dispose();
      filter.dispose();
    }
  };
}
function makeTuba(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "square" },
    envelope: { attack: 0.02, decay: 0.15, sustain: 0.6, release: 0.15 },
    filter: { type: "lowpass", Q: 1 },
    filterEnvelope: { attack: 0.02, decay: 0.15, sustain: 0.5, release: 0.15, baseFrequency: 280, octaves: 1 }
  });
  synth.volume.value = -4;
  synth.connect(out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => synth.dispose()
  };
}
function makeCello(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 0.12, decay: 0.3, sustain: 0.8, release: 0.4 },
    filter: { type: "lowpass", Q: 1 },
    filterEnvelope: { attack: 0.1, decay: 0.3, sustain: 0.6, release: 0.3, baseFrequency: 600, octaves: 0.8 }
  });
  synth.volume.value = -6;
  const vibrato = new Tone.Vibrato(4.5, 0.08);
  synth.chain(vibrato, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      vibrato.dispose();
    }
  };
}
function makeHarpsichord(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: { attack: 2e-3, decay: 0.45, sustain: 0.06, release: 0.12 }
  });
  synth.volume.value = -12;
  const filter = new Tone.Filter(3800, "lowpass");
  synth.chain(filter, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), Math.max(0.15, d), t, v),
    dispose: () => {
      synth.dispose();
      filter.dispose();
    }
  };
}
function makeSupersawLead(out, bpm) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 24 },
    envelope: { attack: 0.01, decay: 0.12, sustain: 0.7, release: 0.15 }
  });
  synth.volume.value = -5;
  const filter = new Tone.Filter(5200, "lowpass");
  const delay = new Tone.FeedbackDelay(60 / bpm / 2, 0.3);
  delay.wet.value = 0.22;
  synth.chain(filter, delay, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => {
      synth.dispose();
      filter.dispose();
      delay.dispose();
    }
  };
}
function makeColdLead(out, bpm) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "square" },
    portamento: 0.06,
    // 60ms glide between notes — the spec's 40–80ms
    envelope: { attack: 0.015, decay: 0.2, sustain: 0.7, release: 0.35 },
    filter: { type: "lowpass", Q: 1.5 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.6, release: 0.3, baseFrequency: 700, octaves: 2 }
  });
  synth.volume.value = -5;
  const chorus = makeChorus(0.8, 0.7);
  const delay = new Tone.FeedbackDelay(60 / bpm * 0.75, 0.28);
  delay.wet.value = 0.24;
  synth.chain(chorus, delay, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      chorus.dispose();
      delay.dispose();
    }
  };
}
function makePostPunkBass(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 6e-3, decay: 0.18, sustain: 0.6, release: 0.12 },
    filter: { type: "lowpass", Q: 2.5 },
    filterEnvelope: { attack: 5e-3, decay: 0.12, sustain: 0.55, release: 0.1, baseFrequency: 500, octaves: 2.6 }
  });
  synth.volume.value = -5;
  const clang = new Tone.Distortion(0.18);
  clang.wet.value = 0.3;
  const chorus = makeChorus(0.6, 0.6);
  synth.chain(clang, chorus, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      clang.dispose();
      chorus.dispose();
    }
  };
}
function makeColdPad(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 2, spread: 18 },
    envelope: { attack: 0.45, decay: 0.5, sustain: 0.75, release: 1.6 }
  });
  synth.volume.value = -19;
  const filter = new Tone.Filter(1500, "lowpass");
  const chorus = makeChorus(0.9, 0.8);
  synth.chain(filter, chorus, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => {
      synth.dispose();
      filter.dispose();
      chorus.dispose();
    }
  };
}
function makeCleanGuitar(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 4e-3, decay: 0.4, sustain: 0.2, release: 0.4 }
  });
  synth.volume.value = -15;
  const hp = new Tone.Filter(200, "highpass");
  const lp = new Tone.Filter(3600, "lowpass");
  const chorus = makeChorus(0.7, 1);
  const verb = new Tone.Reverb({ decay: 1.8, wet: 0.26 });
  synth.chain(hp, lp, chorus, verb, out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), Math.max(0.12, d), t, v),
    ready: verb.ready,
    dispose: () => {
      synth.dispose();
      hp.dispose();
      lp.dispose();
      chorus.dispose();
      verb.dispose();
    }
  };
}
function makePowerGuitar(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 2, spread: 22 },
    envelope: { attack: 5e-3, decay: 0.3, sustain: 0.55, release: 0.18 }
  });
  synth.volume.value = -11;
  const distL = new Tone.Distortion(0.6);
  distL.wet.value = 0.9;
  const distR = new Tone.Distortion(0.64);
  distR.wet.value = 0.9;
  const panL = new Tone.Panner(-0.92);
  const panR = new Tone.Panner(0.92);
  const haas = new Tone.FeedbackDelay(0.013, 0);
  haas.wet.value = 1;
  synth.connect(distL);
  distL.connect(panL);
  panL.connect(out);
  synth.connect(haas);
  haas.connect(distR);
  distR.connect(panR);
  panR.connect(out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => {
      synth.dispose();
      distL.dispose();
      distR.dispose();
      panL.dispose();
      panR.dispose();
      haas.dispose();
    }
  };
}
function makeMetalBass(out) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    envelope: { attack: 4e-3, decay: 0.16, sustain: 0.7, release: 0.1 },
    filter: { type: "lowpass", Q: 2.5 },
    filterEnvelope: { attack: 3e-3, decay: 0.1, sustain: 0.6, release: 0.1, baseFrequency: 600, octaves: 2.8 }
  });
  synth.volume.value = -4;
  const drive = new Tone.Distortion(0.3);
  drive.wet.value = 0.4;
  synth.chain(drive, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    dispose: () => {
      synth.dispose();
      drive.dispose();
    }
  };
}
function makeSymphonicLead(out, bpm) {
  const synth = new Tone.MonoSynth({
    oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
    portamento: 0.05,
    envelope: { attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.4 },
    filter: { type: "lowpass", Q: 1 },
    filterEnvelope: { attack: 0.02, decay: 0.3, sustain: 0.8, release: 0.4, baseFrequency: 1200, octaves: 2.2 }
  });
  synth.volume.value = -4;
  const vibrato = new Tone.Vibrato(5, 0.07);
  const delay = new Tone.FeedbackDelay(60 / bpm / 2, 0.25);
  delay.wet.value = 0.2;
  const hall = new Tone.Reverb({ decay: 2.6, wet: 0.34 });
  synth.chain(vibrato, delay, hall, out);
  return {
    trigger: monoGuard((p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v)),
    ready: hall.ready,
    dispose: () => {
      synth.dispose();
      vibrato.dispose();
      delay.dispose();
      hall.dispose();
    }
  };
}
function makeGenericPoly(out) {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }
  });
  synth.volume.value = -8;
  synth.connect(out);
  return {
    trigger: (p, t, d, v) => synth.triggerAttackRelease(midiHz(p), d, t, v),
    dispose: () => synth.dispose()
  };
}
function makeDrumKit(out, opts = {}) {
  const kick = new Tone.MembraneSynth(
    opts.dullKick ? {
      pitchDecay: 0.015,
      octaves: 1.5,
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.01, release: 0.3 }
    } : opts.softKick ? {
      // Short pitch sweep + a few ms of amp attack — punchy body, no beater click.
      pitchDecay: 0.025,
      octaves: 2.5,
      envelope: { attack: 6e-3, decay: 0.32, sustain: 0.01, release: 0.35 }
    } : {
      // octaves 6→3.5 + attack 1ms→3ms: keeps the punch, kills the harsh
      // beater click and the huge sub-transient that slammed the limiter.
      pitchDecay: 0.03,
      octaves: 3.5,
      envelope: { attack: 3e-3, decay: 0.35, sustain: 0.01, release: 0.4 }
    }
  );
  kick.volume.value = opts.dullKick ? -8 : opts.softKick ? -4 : -2;
  const kickFilter = opts.dullKick ? new Tone.Filter(180, "lowpass") : opts.softKick ? new Tone.Filter(320, "lowpass") : null;
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 1e-3, decay: 0.16, sustain: 0 }
  });
  snare.volume.value = -8;
  const snareBody = new Tone.Filter(1800, "bandpass");
  const gateVerb = opts.gatedSnare ? new Tone.Reverb({ decay: 0.32, wet: 0.5 }) : null;
  if (gateVerb) snare.chain(snareBody, gateVerb, out);
  else snare.chain(snareBody, out);
  const hatTone = new Tone.Filter(7800, "highpass");
  const hatTop = new Tone.Filter(13e3, "lowpass");
  const hat = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 1e-3, decay: 0.035, sustain: 0, release: 0.015 }
  });
  hat.volume.value = -14;
  const hatOpen = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 1e-3, decay: 0.22, sustain: 0, release: 0.08 }
  });
  hatOpen.volume.value = -17;
  const crash = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 1e-3, decay: 1.1, sustain: 0, release: 0.6 }
  });
  crash.volume.value = -13;
  const crashHp = new Tone.Filter(4500, "highpass");
  crash.chain(crashHp, out);
  const tom = new Tone.MembraneSynth({
    pitchDecay: 0.06,
    octaves: 3,
    envelope: { attack: 1e-3, decay: 0.25, sustain: 0.01, release: 0.3 }
  });
  tom.volume.value = -6;
  const clap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 1e-3, decay: 0.09, sustain: 0 }
  });
  clap.volume.value = -8;
  const clapBand = new Tone.Filter({ frequency: 1400, type: "bandpass", Q: 1.2 });
  clap.chain(clapBand, out);
  const shaker = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 1e-3, decay: 0.04, sustain: 0 }
  });
  shaker.volume.value = -20;
  const shakerHp = new Tone.Filter(7500, "highpass");
  shaker.chain(shakerHp, out);
  const tambourine = new Tone.MetalSynth({
    envelope: { attack: 1e-3, decay: 0.12, release: 0.05 },
    harmonicity: 7,
    modulationIndex: 10,
    // tamed so the FM doesn't explode into limiter crackle
    resonance: 5500,
    octaves: 1.4
  });
  tambourine.volume.value = -19;
  const ride = new Tone.MetalSynth({
    envelope: { attack: 2e-3, decay: 0.8, release: 0.4 },
    harmonicity: 4.1,
    modulationIndex: 10,
    resonance: 2400,
    octaves: 1.2
  });
  ride.volume.value = -25;
  const hatOut = opts.hatBus ?? out;
  if (kickFilter) kick.chain(kickFilter, out);
  else kick.connect(out);
  hatTone.chain(hatTop, hatOut);
  hat.connect(hatTone);
  hatOpen.connect(hatTone);
  tom.connect(out);
  ride.connect(out);
  tambourine.connect(hatOut);
  const gKick = monoGuard((p, t, d, v) => {
    kick.triggerAttackRelease(midiHz(p), d, t, v);
    opts.onKick?.(t);
  });
  const gSnare = monoGuard((_p, t, d, v) => snare.triggerAttackRelease(d, t, v));
  const gHat = monoGuard((_p, t, _d, v) => hat.triggerAttackRelease(0.04, t, v));
  const gHatOpen = monoGuard((_p, t, _d, v) => hatOpen.triggerAttackRelease(0.25, t, v));
  const gCrash = monoGuard((_p, t, _d, v) => crash.triggerAttackRelease(1.1, t, v * 0.8));
  const gTom = monoGuard((p, t, d, v) => tom.triggerAttackRelease(midiHz(p), d, t, v));
  const gRide = monoGuard((p, t, _d, v) => ride.triggerAttackRelease(midiHz(p), 0.7, t, v));
  const gTamb = monoGuard((p, t, _d, v) => tambourine.triggerAttackRelease(midiHz(p), 0.15, t, v));
  const gClap = monoGuard((_p, t, d, v) => clap.triggerAttackRelease(d, t, v));
  const gShaker = monoGuard((_p, t, d, v) => shaker.triggerAttackRelease(d, t, v));
  return {
    ready: gateVerb?.ready,
    trigger: (pitch, t, d, v) => {
      switch (pitch) {
        case GM_DRUMS.kick:
          gKick(36, t, d, v);
          break;
        case GM_DRUMS.snare:
          gSnare(0, t, d, v);
          break;
        case GM_DRUMS.hatClosed:
          gHat(90, t, d, v);
          break;
        case GM_DRUMS.hatOpen:
          gHatOpen(88, t, d, v);
          break;
        case GM_DRUMS.crash:
          gCrash(85, t, d, v);
          break;
        case GM_DRUMS.ride:
          gRide(72, t, d, v);
          break;
        case GM_DRUMS.tambourine:
          gTamb(86, t, d, v);
          break;
        case GM_DRUMS.clap:
          gClap(0, t, d, v);
          break;
        case GM_DRUMS.shaker:
          gShaker(0, t, d, v);
          break;
        case GM_DRUMS.tomLow:
          gTom(45, t, d, v);
          break;
        case GM_DRUMS.tomMid:
          gTom(50, t, d, v);
          break;
        case GM_DRUMS.tomHigh:
          gTom(55, t, d, v);
          break;
        default:
          gSnare(0, t, d, v * 0.5);
      }
    },
    dispose: () => {
      kick.dispose();
      kickFilter?.dispose();
      snare.dispose();
      snareBody.dispose();
      gateVerb?.dispose();
      hat.dispose();
      hatTone.dispose();
      hatTop.dispose();
      hatOpen.dispose();
      crash.dispose();
      crashHp.dispose();
      tom.dispose();
      ride.dispose();
      tambourine.dispose();
      clap.dispose();
      clapBand.dispose();
      shaker.dispose();
      shakerHp.dispose();
    }
  };
}
function makeSampler(def, out, exposeCutoff = false, stereo) {
  const useStereo = !!(def.doubleTrack && stereo);
  const dynamic = !exposeCutoff;
  const created = [];
  const buildPath = (dest) => {
    const sampler = new Tone.Sampler({
      urls: def.urls,
      baseUrl: resolveSampleBase(def.baseUrl),
      release: def.release ?? 0.4,
      attack: def.attack ?? 0
    });
    sampler.volume.value = def.volumeDb ?? -6;
    const chain = [];
    if (def.vibrato) {
      const vib = new Tone.Vibrato(def.vibrato.rate, def.vibrato.depth);
      chain.push(vib);
    }
    if (def.distortion) {
      const dist = new Tone.Distortion(def.distortion);
      dist.oversample = "2x";
      dist.wet.value = 0.9;
      chain.push(dist);
    }
    if (def.cab) chain.push(new Tone.Filter(def.cab.hp, "highpass"));
    const bright = new Tone.Filter(def.cab?.lp ?? (exposeCutoff ? 12e3 : 16e3), "lowpass");
    chain.push(bright);
    sampler.chain(...chain, dest);
    created.push(sampler, ...chain);
    return { sampler, bright };
  };
  const paths = [];
  if (useStereo) {
    for (let i = 0; i < 2; i++) {
      const pan = new Tone.Panner(i === 0 ? -stereo.spread : stereo.spread);
      pan.connect(stereo.bus);
      created.push(pan);
      if (stereo.send > 0) {
        const g = new Tone.Gain(stereo.send);
        pan.connect(g);
        g.connect(stereo.reverb);
        created.push(g);
      }
      paths.push(buildPath(pan));
    }
  } else {
    paths.push(buildPath(out));
  }
  const brightHzFor = (d, v) => {
    let hz;
    if (def.palmMute) {
      const open = Math.min(1, d / 0.22);
      hz = 1100 + 5e3 * open * (0.55 + 0.45 * v);
    } else {
      hz = 2200 + 13800 * Math.min(1, v * v);
    }
    return def.cab ? Math.min(hz, def.cab.lp) : hz;
  };
  let trigger = (p, t, d, v) => {
    const hz = brightHzFor(d, v);
    paths.forEach((path, i) => {
      if (dynamic) {
        try {
          path.bright.frequency.setValueAtTime(hz, Math.max(0, t - 1e-3));
        } catch {
        }
      }
      const tt = useStereo && i === 1 ? t + 0.012 : t;
      path.sampler.triggerAttackRelease(midiHz(p), Math.max(0.05, d), tt, v);
    });
  };
  if (def.monophonic) trigger = monoGuard(trigger);
  return {
    trigger,
    cutoff: useStereo ? void 0 : paths[0].bright.frequency,
    ready: Tone.loaded(),
    dispose: () => {
      for (const n of created) n.dispose();
    }
  };
}
var VOICE_PAN = { chords: 0.22, arp: -0.2, counter: 0.3, lead: 0, bass: 0 };
var VOICE_SEND = {
  lead: 0.2,
  chords: 0.32,
  bass: 0.04,
  arp: 0.12,
  drums: 0.08,
  counter: 0.2,
  fx: 0.16
};
var DRUM_LANE_PAN = {
  kick: 0,
  snare: 0,
  hatClosed: 0.22,
  hatOpen: 0.28,
  crash: -0.35,
  tomHigh: 0.3,
  tomLow: -0.3,
  clap: -0.18
};
function makeRealDrumKit(out, def, opts = {}) {
  const kitGain = new Tone.Gain(1);
  kitGain.connect(out);
  let sendGain = null;
  if (opts.reverb && opts.send && opts.send > 0) {
    sendGain = new Tone.Gain(opts.send);
    kitGain.connect(sendGain);
    sendGain.connect(opts.reverb);
  }
  const lanePanners = {};
  for (const laneName of Object.keys(def.lanes)) {
    const p = new Tone.Panner(DRUM_LANE_PAN[laneName] ?? 0);
    p.connect(kitGain);
    lanePanners[laneName] = p;
  }
  const fileToPlayer = {};
  for (const [laneName, lane] of Object.entries(def.lanes))
    for (const layer of lane.layers)
      for (const f of layer.rr) {
        const key = f.replace(/\.mp3$/, "");
        const pl = new Tone.Player({ url: resolveSampleBase(def.baseUrl) + f, volume: -3 });
        pl.connect(lanePanners[laneName]);
        fileToPlayer[key] = pl;
      }
  const NOTE_TO_LANE = {
    [GM_DRUMS.kick]: "kick",
    [GM_DRUMS.snare]: "snare",
    [GM_DRUMS.hatClosed]: "hatClosed",
    [GM_DRUMS.hatOpen]: "hatOpen",
    [GM_DRUMS.crash]: "crash",
    [GM_DRUMS.ride]: "crash",
    [GM_DRUMS.tomHigh]: "tomHigh",
    [GM_DRUMS.tomMid]: "tomLow",
    [GM_DRUMS.tomLow]: "tomLow",
    [GM_DRUMS.clap]: "clap",
    [GM_DRUMS.tambourine]: "hatClosed",
    [GM_DRUMS.shaker]: "hatClosed"
  };
  const rng = makeRng(2654435769);
  const lastRr = /* @__PURE__ */ new Map();
  const lastLayer = /* @__PURE__ */ new Map();
  const lastStart = /* @__PURE__ */ new Map();
  return {
    ready: Tone.loaded(),
    trigger: (pitch, t, _d, v) => {
      const lane = NOTE_TO_LANE[pitch];
      if (!lane) return;
      const laneDef = def.lanes[lane];
      if (!laneDef) return;
      v = Math.max(0.06, Math.min(1, v));
      let li = laneDef.layers.findIndex((l) => v <= l.vMax);
      if (li < 0) li = laneDef.layers.length - 1;
      const prevLi = lastLayer.get(lane);
      if (prevLi !== void 0 && Math.abs(li - prevLi) === 1) {
        const boundary = laneDef.layers[Math.min(li, prevLi)].vMax;
        if (Math.abs(v - boundary) < 0.06) li = prevLi;
      }
      lastLayer.set(lane, li);
      const layer = laneDef.layers[li];
      const key = `${lane}:${li}`;
      const prev = lastRr.get(key);
      const ri = prev === void 0 ? 0 : (prev + 1) % layer.rr.length;
      lastRr.set(key, ri);
      const file = layer.rr[ri].replace(/\.mp3$/, "");
      const pl = fileToPlayer[file];
      if (!pl) return;
      const ls = lastStart.get(file) ?? -1;
      if (t <= ls + 2e-3) t = ls + 2e-3;
      lastStart.set(file, t);
      pl.volume.value = Tone.gainToDb(0.5 + 0.5 * v) + (rng() - 0.5);
      pl.playbackRate = 1 + (rng() - 0.5) * 0.012;
      try {
        pl.start(t);
      } catch {
        return;
      }
      if (lane === "kick") opts.onKick?.(t);
    },
    dispose: () => {
      for (const pl of Object.values(fileToPlayer)) pl.dispose();
      for (const p of Object.values(lanePanners)) p.dispose();
      sendGain?.dispose();
      kitGain.dispose();
    }
  };
}
function voiceForTrack(track, bpm, out, real, autoTarget, stereoCtx) {
  if (track.role === "drums") return makeDrumKit(out);
  if (real) {
    const set = REAL_PROGRAM_MAP[track.program];
    if (set) {
      const def = SAMPLE_SETS[set];
      const exposeCutoff = autoTarget === track.role;
      const stereo = def.doubleTrack && stereoCtx ? { bus: stereoCtx.bus, reverb: stereoCtx.reverb, send: VOICE_SEND[track.role] ?? 0.12, spread: 0.75 } : void 0;
      return makeSampler(def, out, exposeCutoff, stereo);
    }
  }
  switch (track.program) {
    case 80:
      return makeSquareLead(out, bpm);
    case 81:
      return makeSawArp(out);
    case 38:
      return makeSynthBass(out);
    case 33:
      return makePostPunkBass(out);
    case 27:
      return makeCleanGuitar(out);
    case 30:
      return makePowerGuitar(out);
    case 34:
      return makeMetalBass(out);
    case 49:
      return makeSymphonicLead(out, bpm);
    case 113:
      return makeCowbellLead(out);
    case 39:
      return makeBass808(out);
    case 59:
      return makeMutedTrumpet(out);
    case 32:
      return makeUprightBass(out);
    case 10:
      return makeMusicBox(out);
    case 11:
      return makeVibraphone(out);
    case 89:
      return makeDarkPad(out);
    case 0:
    case 1:
      return makePiano(out);
    case 40:
      return makeStrings(out, true);
    case 48:
      return makeStrings(out, false);
    case 22:
      return makeHarmonica(out);
    case 56:
      return makeTrumpet(out);
    case 61:
      return makeBrassSection(out);
    case 58:
      return makeTuba(out);
    case 42:
      return makeCello(out);
    case 6:
      return makeHarpsichord(out);
    case 90:
      return makeSupersawLead(out, bpm);
    case 88:
      return makeColdLead(out, bpm);
    case 91:
      return makeColdPad(out);
    default:
      return makeGenericPoly(out);
  }
}
function masterFx(genre) {
  switch (genre) {
    case "noir": {
      const sat = new Tone.Distortion(0.08);
      sat.wet.value = 0.4;
      const chamber = new Tone.Reverb({ decay: 4.5, wet: 0.32 });
      const wow = new Tone.Vibrato(0.7, 0.012);
      return [sat, chamber, wow, new Tone.Filter(9e3, "lowpass"), new Tone.Filter(45, "highpass")];
    }
    case "grime": {
      const dirt = new Tone.Distortion(0.06);
      dirt.wet.value = 0.5;
      return [dirt, new Tone.Filter(9e3, "lowpass")];
    }
    case "phonk": {
      const clip = new Tone.Distortion(0.5);
      clip.wet.value = 0.7;
      return [clip, new Tone.Filter(7500, "lowpass")];
    }
    case "anime":
      return [new Tone.Reverb({ decay: 1.4, wet: 0.16 })];
    case "nightcore":
      return [new Tone.Reverb({ decay: 1.6, wet: 0.18 })];
    case "blues":
      return [new Tone.Reverb({ decay: 1.1, wet: 0.14 })];
    case "military":
      return [new Tone.Reverb({ decay: 1, wet: 0.2 })];
    // parade square air
    case "darkacademia":
      return [new Tone.Reverb({ decay: 2.4, wet: 0.3 })];
    // stone hall
    case "musicbox":
      return [new Tone.Reverb({ decay: 2.2, wet: 0.28 }), new Tone.Filter(250, "highpass")];
    // tiny box in a quiet room
    case "nightcorerun": {
      const glue = new Tone.Distortion(0.06);
      glue.wet.value = 0.35;
      return [glue];
    }
    case "doomerwave":
    case "doomerrun": {
      const wow = new Tone.Vibrato(0.6, 0.012);
      const chamber = new Tone.Reverb({ decay: 2, wet: 0.2 });
      return [wow, chamber, new Tone.Filter(11e3, "lowpass")];
    }
    default:
      return [];
  }
}
function buildFilterAutomations(song, cutoff) {
  const spec = getGenre(song.genre).filterAutomation;
  if (!spec || !cutoff) return [];
  const beatTicks = PPQ * 4 / song.timeSig[1];
  const barTicks = beatTicks * song.timeSig[0];
  const secPerTick = 60 / song.bpm / PPQ;
  const automations = [];
  for (const s of song.sections) {
    const t0 = s.startBar * barTicks * secPerTick;
    const durSec = s.bars * barTicks * secPerTick;
    const move = spec.sections[s.name];
    automations.push({
      time: t0,
      apply: (t) => {
        cutoff.cancelScheduledValues(t);
        if (move?.move === "closed") {
          cutoff.setValueAtTime(cutoff.getValueAtTime(t), t);
          cutoff.linearRampToValueAtTime(move.hz, t + 0.3);
        } else if (move?.move === "sweep") {
          cutoff.setValueAtTime(move.fromHz, t);
          cutoff.linearRampToValueAtTime(spec.open, t + durSec);
        } else {
          cutoff.setValueAtTime(spec.open, t);
        }
      }
    });
  }
  return automations;
}
function buildEnsemble(song, opts = {}) {
  const real = opts.real ?? false;
  const spec = getGenre(song.genre).filterAutomation;
  const bus = new Tone.Gain(0.9);
  const subCut = new Tone.Filter(30, "highpass");
  const masterFilter = spec?.target === "master" ? new Tone.Filter(spec.open, "lowpass") : null;
  const fx = masterFx(song.genre);
  const compressor = new Tone.Compressor({ threshold: -14, ratio: 3, attack: 0.03, release: 0.25, knee: 8 });
  const limiter = new Tone.Limiter(-1);
  bus.chain(subCut, ...masterFilter ? [masterFilter] : [], ...fx, compressor, limiter, Tone.getDestination());
  const isPhonk = song.genre === "phonk";
  const extras = [];
  const reverb = real ? new Tone.Reverb({ decay: 1.8, wet: 1 }) : null;
  reverb?.connect(bus);
  if (reverb) extras.push(reverb);
  const spatials = [];
  const spatialOut = (role) => {
    if (!real || !reverb) return bus;
    const pan = new Tone.Panner(VOICE_PAN[role] ?? 0);
    pan.connect(bus);
    const send = VOICE_SEND[role] ?? 0.1;
    if (send > 0) {
      const g = new Tone.Gain(send);
      pan.connect(g);
      g.connect(reverb);
      spatials.push(g);
    }
    spatials.push(pan);
    return pan;
  };
  if (song.genre === "noir") {
    const rain = new Tone.Noise("pink");
    rain.volume.value = -41;
    const rainFilter = new Tone.Filter(1300, "lowpass");
    rain.chain(rainFilter, bus);
    rain.sync().start(0);
    extras.push(rain, rainFilter);
    const vinyl = new Tone.Noise("white");
    vinyl.volume.value = -46;
    const vinylBand = new Tone.Filter({ frequency: 3200, type: "bandpass", Q: 0.6 });
    vinyl.chain(vinylBand, bus);
    vinyl.sync().start(0);
    extras.push(vinyl, vinylBand);
    const stir = new Tone.Noise("white");
    stir.volume.value = -42;
    const stirBand = new Tone.Filter({ frequency: 5200, type: "bandpass", Q: 1.2 });
    const stirSwell = new Tone.Tremolo(song.bpm / 60, 0.85).start();
    stir.chain(stirBand, stirSwell, bus);
    stir.sync().start(0);
    extras.push(stir, stirBand, stirSwell);
  }
  let duck = null;
  let onKick;
  if (isPhonk) {
    duck = new Tone.Gain(1);
    duck.connect(bus);
    extras.push(duck);
    const hiss = new Tone.Noise("pink");
    hiss.volume.value = -42;
    hiss.connect(bus);
    hiss.sync().start(0);
    extras.push(hiss);
    const g = duck.gain;
    onKick = (t) => {
      g.cancelAndHoldAtTime(t);
      g.linearRampToValueAtTime(0.18, t + 5e-3);
      g.linearRampToValueAtTime(1, t + 0.13);
    };
  }
  const voices = song.tracks.map((t) => {
    if (isPhonk && t.role === "drums") return makeDrumKit(bus, { hatBus: duck, onKick });
    if (isPhonk && t.role === "lead") return makePhonkCowbell(duck);
    if (t.role === "drums") {
      const kit = real ? REAL_DRUM_KITS[song.genre] : void 0;
      if (kit) return makeRealDrumKit(bus, kit, { onKick, reverb: reverb ?? void 0, send: VOICE_SEND.drums });
      if (song.genre === "noir") return makeDrumKit(bus, { dullKick: true });
      if (song.genre === "doomerwave" || song.genre === "doomerrun")
        return makeDrumKit(bus, { softKick: true, gatedSnare: true });
      return makeDrumKit(bus);
    }
    return voiceForTrack(
      t,
      song.bpm,
      spatialOut(t.role),
      real,
      spec?.target,
      real && reverb ? { bus, reverb } : void 0
    );
  });
  const cutoffOf = (target) => target === "master" ? masterFilter?.frequency : voices[song.tracks.findIndex((t) => t.role === target)]?.cutoff;
  const automations = spec ? buildFilterAutomations(song, cutoffOf(spec.target)) : [];
  const ready = Promise.all([
    ...fx.filter((n) => n instanceof Tone.Reverb).map((n) => n.ready),
    ...reverb ? [reverb.ready] : [],
    ...voices.map((v) => v.ready ?? Promise.resolve())
  ]);
  return {
    voices,
    automations,
    ready,
    dispose: () => {
      for (const v of voices) v.dispose();
      for (const s of spatials) s.dispose();
      for (const x of extras) x.dispose();
      bus.dispose();
      subCut.dispose();
      masterFilter?.dispose();
      for (const node of fx) node.dispose();
      compressor.dispose();
      limiter.dispose();
    }
  };
}

// src/audio/perform.ts
function makeRng2(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var roleSeed = {
  lead: 4369,
  chords: 8738,
  bass: 13107,
  drums: 17476,
  arp: 21845,
  counter: 26214,
  fx: 30583
};
var FEEL = {
  lead: { jitterMs: 12, pushMs: 2, velSpread: 0.1, legato: true },
  chords: { jitterMs: 9, pushMs: 4, velSpread: 0.08, legato: true },
  bass: { jitterMs: 4, pushMs: 0, velSpread: 0.07, legato: false },
  arp: { jitterMs: 5, pushMs: 0, velSpread: 0.09, legato: false },
  // Drums stay tight: heavy timing jitter turns fast rolls/blasts into sloppy
  // stumbles, and wide velocity jitter flickers the kit's velocity layers.
  drums: { jitterMs: 1.5, pushMs: 0, velSpread: 0.05, legato: false },
  counter: { jitterMs: 8, pushMs: 2, velSpread: 0.09, legato: true },
  fx: { jitterMs: 6, pushMs: 0, velSpread: 0.06, legato: false }
};
function perform(track, song) {
  const secPerTick = 60 / song.bpm / PPQ;
  const beatTicks = PPQ * 4 / song.timeSig[1];
  const barTicks = song.timeSig[0] * beatTicks;
  const feel = FEEL[track.role];
  const rng = makeRng2((Number(song.seed & 0xffffffffn) ^ roleSeed[track.role]) >>> 0);
  const notes = [...track.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return notes.map((n, i) => {
    const tickInBar = (n.start % barTicks + barTicks) % barTicks;
    const onBeat = tickInBar % beatTicks === 0;
    const downBeat = tickInBar === 0;
    let offMs = feel.pushMs + (rng() - 0.5) * 2 * feel.jitterMs;
    if (track.role === "drums" && n.pitch === GM_DRUMS.snare) offMs += 2;
    const time = Math.max(0, n.start * secPerTick + offMs / 1e3);
    let vel = n.vel / 127;
    if (downBeat) vel += 0.08;
    else if (onBeat) vel += 0.04;
    else vel -= 0.03;
    vel += (rng() - 0.5) * 2 * feel.velSpread;
    vel = Math.max(0.05, Math.min(1, vel));
    let dur = n.dur * secPerTick * (0.9 + 0.3 * vel);
    if (feel.legato) {
      const next = notes[i + 1];
      if (next) {
        const gapSec = (next.start - n.start) * secPerTick;
        if (gapSec > 0 && gapSec < 2) dur = Math.max(dur, gapSec * 0.97);
      }
    }
    dur = Math.max(0.02, dur);
    return { time, pitch: n.pitch, dur, vel, slide: n.slide };
  });
}

// src/audio/offline.ts
async function renderSong(song, opts = {}) {
  const secPerTick = 60 / song.bpm / PPQ;
  const durationSec = song.durationTicks * secPerTick + 2;
  const real = opts.real ?? false;
  const toneBuffer = await Tone2.Offline(
    async ({ transport }) => {
      const ensemble = buildEnsemble(song, { real });
      await ensemble.ready;
      song.tracks.forEach((track, i) => {
        const voice = ensemble.voices[i];
        const events = real ? perform(track, song) : track.notes.map((n) => ({
          time: n.start * secPerTick,
          pitch: n.pitch,
          dur: Math.max(0.02, n.dur * secPerTick),
          vel: n.vel / 127,
          slide: n.slide
        }));
        new Tone2.Part((time, ev) => {
          try {
            voice.trigger(ev.pitch, time, ev.dur, ev.vel, ev.slide);
          } catch {
          }
        }, events).start(0);
      });
      for (const a of ensemble.automations) {
        transport.schedule((t) => a.apply(t), a.time);
      }
      transport.start(0.02);
    },
    durationSec,
    2,
    44100
  );
  return toneBuffer.get();
}

// src/audio/encode/wav.ts
function audioBufferToWav(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const frames = buffer.length;
  const dataSize = frames * channels * 2;
  const out = new DataView(new ArrayBuffer(44 + dataSize));
  const str = (offset2, s) => {
    for (let i = 0; i < s.length; i++) out.setUint8(offset2 + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  out.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, channels, true);
  out.setUint32(24, buffer.sampleRate, true);
  out.setUint32(28, buffer.sampleRate * channels * 2, true);
  out.setUint16(32, channels * 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, dataSize, true);
  const chans = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      out.setInt16(offset, v < 0 ? v * 32768 : v * 32767, true);
      offset += 2;
    }
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

// src/audio/player.ts
import * as Tone3 from "tone";
var rtConfigured = false;
function configureRealtimeAudio() {
  if (rtConfigured) return;
  rtConfigured = true;
  try {
    const ctx = new Tone3.Context({ latencyHint: "playback" });
    ctx.lookAhead = 0.2;
    Tone3.setContext(ctx);
  } catch {
    try {
      Tone3.getContext().lookAhead = 0.2;
    } catch {
    }
  }
}
configureRealtimeAudio();
function createPlayer(song, opts = {}) {
  const secPerTick = 60 / song.bpm / PPQ;
  const durationSec = song.durationTicks * secPerTick;
  const TAIL = 1.5;
  let ensemble = null;
  let parts = [];
  let playing = false;
  let loop = opts.loop ?? true;
  let endEventId = -1;
  const transport = Tone3.getTransport();
  const applyLoop = () => {
    transport.loop = loop;
    if (loop) {
      transport.loopStart = 0;
      transport.loopEnd = durationSec;
    }
  };
  const scheduleEnd = () => {
    if (endEventId >= 0) transport.clear(endEventId);
    endEventId = -1;
    if (!loop && playing) {
      endEventId = transport.scheduleOnce(() => {
        player.stop();
        player.onEnded?.();
      }, durationSec + TAIL);
    }
  };
  const build = () => {
    const real = opts.real ?? false;
    ensemble = buildEnsemble(song, { real });
    parts = song.tracks.map((track, i) => {
      const voice = ensemble.voices[i];
      const events = real ? perform(track, song) : track.notes.map((n) => ({
        time: n.start * secPerTick,
        pitch: n.pitch,
        dur: Math.max(0.02, n.dur * secPerTick),
        vel: n.vel / 127,
        slide: n.slide
      }));
      const part = new Tone3.Part((time, ev) => {
        try {
          voice.trigger(ev.pitch, time, ev.dur, ev.vel, ev.slide);
        } catch {
        }
      }, events);
      part.start(0);
      return part;
    });
    for (const a of ensemble.automations) {
      transport.schedule((t) => a.apply(t), a.time);
    }
  };
  const player = {
    durationSec,
    async play() {
      await Tone3.start();
      if (!ensemble) build();
      if (playing) return;
      playing = true;
      applyLoop();
      scheduleEnd();
      transport.start();
    },
    stop() {
      if (endEventId >= 0) transport.clear(endEventId);
      endEventId = -1;
      transport.stop();
      transport.position = 0;
      transport.loop = false;
      playing = false;
    },
    isPlaying: () => playing,
    positionSec: () => {
      const ctx = Tone3.getContext();
      const raw = ctx.rawContext;
      const latency = ctx.lookAhead + (raw.outputLatency || raw.baseLatency || 0);
      return Math.max(0, Math.min(transport.seconds - latency, durationSec));
    },
    setLoop(on) {
      loop = on;
      if (playing) {
        applyLoop();
        scheduleEnd();
      }
    },
    looping: () => loop,
    dispose() {
      player.stop();
      for (const p of parts) p.dispose();
      parts = [];
      ensemble?.dispose();
      ensemble = null;
      transport.cancel();
    }
  };
  return player;
}

// src/audio/index.ts
async function renderToWav(song, opts = {}) {
  return audioBufferToWav(await renderSong(song, { real: opts.real }));
}
export {
  audioBufferToWav,
  buildEnsemble,
  createPlayer,
  renderSong,
  renderToWav
};
//# sourceMappingURL=audio.js.map