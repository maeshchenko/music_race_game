import {
  GM_DRUMS,
  PPQ,
  getGenre
} from "./chunk-MT55CDIL.js";

// src/audio/offline.ts
import * as Tone2 from "tone";

// src/audio/instruments.ts
import * as Tone from "tone";
var midiHz = (pitch) => 440 * 2 ** ((pitch - 69) / 12);
function monoGuard(trigger) {
  let last = -1;
  return (p, t, d, v) => {
    if (t <= last + 2e-3) t = last + 2e-3;
    last = t;
    trigger(p, t, d, v);
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
  synth.volume.value = -1;
  const dist = new Tone.Distortion(0.5);
  dist.wet.value = 0.35;
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
  synth.volume.value = solo ? -8 : -16;
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
  synth.volume.value = -9;
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
    } : {
      pitchDecay: 0.04,
      octaves: 6,
      envelope: { attack: 1e-3, decay: 0.35, sustain: 0.01, release: 0.4 }
    }
  );
  kick.volume.value = opts.dullKick ? -8 : -2;
  const kickFilter = opts.dullKick ? new Tone.Filter(180, "lowpass") : null;
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 1e-3, decay: 0.16, sustain: 0 }
  });
  snare.volume.value = -8;
  const snareBody = new Tone.Filter(1800, "bandpass");
  snare.chain(snareBody, out);
  const hat = new Tone.MetalSynth({
    envelope: { attack: 1e-3, decay: 0.045, release: 0.02 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4e3,
    octaves: 1.5
  });
  hat.volume.value = -18;
  const hatOpen = new Tone.MetalSynth({
    envelope: { attack: 1e-3, decay: 0.25, release: 0.1 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4e3,
    octaves: 1.5
  });
  hatOpen.volume.value = -20;
  const crash = new Tone.MetalSynth({
    envelope: { attack: 1e-3, decay: 1.2, release: 0.6 },
    harmonicity: 5,
    modulationIndex: 40,
    resonance: 5e3,
    octaves: 1.8
  });
  crash.volume.value = -16;
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
    modulationIndex: 28,
    resonance: 5500,
    octaves: 1.4
  });
  tambourine.volume.value = -16;
  const ride = new Tone.MetalSynth({
    envelope: { attack: 2e-3, decay: 0.8, release: 0.4 },
    harmonicity: 4.1,
    modulationIndex: 20,
    resonance: 2400,
    octaves: 1.2
  });
  ride.volume.value = -22;
  const hatOut = opts.hatBus ?? out;
  if (kickFilter) kick.chain(kickFilter, out);
  else kick.connect(out);
  hat.connect(hatOut);
  hatOpen.connect(hatOut);
  crash.connect(out);
  tom.connect(out);
  ride.connect(out);
  tambourine.connect(hatOut);
  const gKick = monoGuard((p, t, d, v) => {
    kick.triggerAttackRelease(midiHz(p), d, t, v);
    opts.onKick?.(t);
  });
  const gSnare = monoGuard((_p, t, d, v) => snare.triggerAttackRelease(d, t, v));
  const gHat = monoGuard((p, t, _d, v) => hat.triggerAttackRelease(midiHz(p), 0.05, t, v));
  const gHatOpen = monoGuard((p, t, _d, v) => hatOpen.triggerAttackRelease(midiHz(p), 0.3, t, v));
  const gCrash = monoGuard((p, t, _d, v) => crash.triggerAttackRelease(midiHz(p), 1.4, t, v * 0.8));
  const gTom = monoGuard((p, t, d, v) => tom.triggerAttackRelease(midiHz(p), d, t, v));
  const gRide = monoGuard((p, t, _d, v) => ride.triggerAttackRelease(midiHz(p), 0.7, t, v));
  const gTamb = monoGuard((p, t, _d, v) => tambourine.triggerAttackRelease(midiHz(p), 0.15, t, v));
  const gClap = monoGuard((_p, t, d, v) => clap.triggerAttackRelease(d, t, v));
  const gShaker = monoGuard((_p, t, d, v) => shaker.triggerAttackRelease(d, t, v));
  return {
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
      hat.dispose();
      hatOpen.dispose();
      crash.dispose();
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
function voiceForTrack(track, bpm, out) {
  if (track.role === "drums") return makeDrumKit(out);
  switch (track.program) {
    case 80:
      return makeSquareLead(out, bpm);
    case 81:
      return makeSawArp(out);
    case 38:
      return makeSynthBass(out);
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
function buildEnsemble(song) {
  const spec = getGenre(song.genre).filterAutomation;
  const bus = new Tone.Gain(1);
  const masterFilter = spec?.target === "master" ? new Tone.Filter(spec.open, "lowpass") : null;
  const fx = masterFx(song.genre);
  const compressor = new Tone.Compressor(-14, 3);
  const limiter = new Tone.Limiter(-1);
  bus.chain(...masterFilter ? [masterFilter] : [], ...fx, compressor, limiter, Tone.getDestination());
  const isPhonk = song.genre === "phonk";
  const extras = [];
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
    if (song.genre === "noir" && t.role === "drums") return makeDrumKit(bus, { dullKick: true });
    return voiceForTrack(t, song.bpm, bus);
  });
  const cutoffOf = (target) => target === "master" ? masterFilter?.frequency : voices[song.tracks.findIndex((t) => t.role === target)]?.cutoff;
  const automations = spec ? buildFilterAutomations(song, cutoffOf(spec.target)) : [];
  const ready = Promise.all([
    ...fx.filter((n) => n instanceof Tone.Reverb).map((n) => n.ready),
    ...voices.map((v) => v.ready ?? Promise.resolve())
  ]);
  return {
    voices,
    automations,
    ready,
    dispose: () => {
      for (const v of voices) v.dispose();
      for (const x of extras) x.dispose();
      bus.dispose();
      masterFilter?.dispose();
      for (const node of fx) node.dispose();
      compressor.dispose();
      limiter.dispose();
    }
  };
}

// src/audio/offline.ts
async function renderSong(song) {
  const secPerTick = 60 / song.bpm / PPQ;
  const durationSec = song.durationTicks * secPerTick + 2;
  const toneBuffer = await Tone2.Offline(
    async ({ transport }) => {
      const ensemble = buildEnsemble(song);
      await ensemble.ready;
      song.tracks.forEach((track, i) => {
        const voice = ensemble.voices[i];
        const events = track.notes.map((n) => ({
          time: n.start * secPerTick,
          pitch: n.pitch,
          dur: Math.max(0.02, n.dur * secPerTick),
          vel: n.vel / 127,
          slide: n.slide
        }));
        new Tone2.Part((time, ev) => {
          voice.trigger(ev.pitch, time, ev.dur, ev.vel, ev.slide);
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
    ensemble = buildEnsemble(song);
    parts = song.tracks.map((track, i) => {
      const voice = ensemble.voices[i];
      const events = track.notes.map((n) => ({
        time: n.start * secPerTick,
        pitch: n.pitch,
        dur: Math.max(0.02, n.dur * secPerTick),
        vel: n.vel / 127,
        slide: n.slide
      }));
      const part = new Tone3.Part((time, ev) => {
        voice.trigger(ev.pitch, time, ev.dur, ev.vel, ev.slide);
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
async function renderToWav(song) {
  return audioBufferToWav(await renderSong(song));
}
export {
  audioBufferToWav,
  buildEnsemble,
  createPlayer,
  renderSong,
  renderToWav
};
//# sourceMappingURL=audio.js.map