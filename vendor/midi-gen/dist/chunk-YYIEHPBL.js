var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/types.ts
var GENRE_IDS = [
  "keygen",
  "noir",
  "anime",
  "phonk",
  "blues",
  "military",
  "darkacademia",
  "grime",
  "nightcore",
  "tune",
  "musicbox",
  "eurobeat",
  "outrun",
  "grimerun",
  "doomerwave",
  "doomerrun",
  "nightcorerun",
  "test"
];
function sectionKey(s) {
  return s.variant ? `${s.name}#${s.variant}` : s.name;
}
var PPQ = 480;
var DRUM_CHANNEL = 9;

// src/core/theory/scales.ts
var SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  blues: [0, 3, 5, 6, 7, 10],
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9]
};
var mod12 = (n) => (n % 12 + 12) % 12;
function inScale(pitch, tonic, mode) {
  return SCALE_INTERVALS[mode].includes(mod12(pitch - tonic));
}

// src/core/gen/melody.ts
var STEP = PPQ / 4;
var UNIT_BARS = 2;
function buildRhythm(rng, cfg, stepsPerBar) {
  const steps = UNIT_BARS * stepsPerBar;
  const half = stepsPerBar / 2;
  const onsets = [];
  for (let s = 0; s < steps; s++) {
    const inBar = s % stepsPerBar;
    let w;
    if (inBar === 0) w = 1;
    else if (inBar === half) w = 0.85;
    else if (inBar % 4 === 0) w = 0.7;
    else if (inBar % 2 === 0) w = 0.5;
    else w = 0.4 * cfg.syncopation;
    if (s === 0 || rng.next() < w * cfg.density) onsets.push(s);
  }
  return onsets.map((s, i) => {
    const next = onsets[i + 1] ?? steps;
    let durSteps = Math.min(next - s, 8);
    if (rng.chance(cfg.restProb)) durSteps = Math.max(1, Math.ceil(durSteps / 2));
    return { step: s, durSteps };
  });
}
function nextScalePitch(p, dir, tonic, mode) {
  let q = p + dir;
  while (!inScale(q, tonic, mode)) q += dir;
  return q;
}
function nearestChordTone(p, chord) {
  for (let d = 0; d < 12; d++) {
    if (chord.pitchClasses.includes(mod12(p - d))) return p - d;
    if (chord.pitchClasses.includes(mod12(p + d))) return p + d;
  }
  return p;
}
function clampRegister(p, lo, hi) {
  while (p > hi) p -= 12;
  while (p < lo) p += 12;
  return p;
}
function assignPitches(rng, ctx, rhythm, unitStartTick, stepsPerBar, state) {
  const { register, leapProb } = ctx.cfg.melody;
  const [lo, hi] = register;
  const center = (lo + hi) / 2;
  const tonic = ctx.key.tonic;
  const mode = ctx.cfg.melody.scale ?? ctx.key.mode;
  const strongEvery = Math.max(2, stepsPerBar / 2);
  const notes = [];
  for (const ev of rhythm) {
    const tick = unitStartTick + ev.step * STEP;
    const chord = ctx.chordAt(tick);
    const strong = ev.step % strongEvery === 0;
    if (strong) {
      state.pitch = clampRegister(nearestChordTone(state.pitch, chord), lo, hi);
      state.leapDir = 0;
    } else if (state.leapDir !== 0) {
      state.pitch = clampRegister(
        nextScalePitch(state.pitch, state.leapDir === 1 ? -1 : 1, tonic, mode),
        lo,
        hi
      );
      state.leapDir = 0;
    } else if (rng.chance(leapProb)) {
      const candidates = [];
      for (let p = Math.max(lo, state.pitch - 12); p <= Math.min(hi, state.pitch + 12); p++) {
        if (chord.pitchClasses.includes(mod12(p)) && Math.abs(p - state.pitch) >= 3) {
          candidates.push(p);
        }
      }
      if (candidates.length > 0) {
        const target = rng.pick(candidates);
        state.leapDir = target > state.pitch ? 1 : -1;
        if (Math.abs(target - state.pitch) < 5) state.leapDir = 0;
        state.pitch = target;
      }
    } else {
      const towardCenter = state.pitch > center ? -1 : 1;
      const dir = rng.chance(0.65) ? towardCenter : -towardCenter;
      state.pitch = clampRegister(nextScalePitch(state.pitch, dir, tonic, mode), lo, hi);
    }
    notes.push({
      pitch: state.pitch,
      start: tick,
      dur: Math.max(30, ev.durSteps * STEP - 20),
      vel: (strong ? rng.int(96, 110) : rng.int(78, 96)) | 0
    });
  }
  return notes;
}
var genMelody = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const stepsPerBar = Math.round(ctx.barTicks / STEP);
  const unitTicks = UNIT_BARS * ctx.barTicks;
  const cache = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    const sectionStart = section.startBar * ctx.barTicks;
    const sectionTicks = section.bars * ctx.barTicks;
    const cached = cache.get(sectionKey(section));
    if (cached) {
      notes.push(...cached.map((n) => ({ ...n, start: n.start + sectionStart })));
      continue;
    }
    const rhythmA = buildRhythm(rng, ctx.cfg.melody, stepsPerBar);
    const rhythmB = buildRhythm(rng, ctx.cfg.melody, stepsPerBar);
    const units = Math.ceil(section.bars / UNIT_BARS);
    const state = { pitch: Math.round((ctx.cfg.melody.register[0] + ctx.cfg.melody.register[1]) / 2), leapDir: 0 };
    const sectionNotes = [];
    for (let u = 0; u < units; u++) {
      const unitStart = sectionStart + u * unitTicks;
      const rhythm = u % 4 === 2 ? rhythmB : rhythmA;
      const unitNotes = assignPitches(rng, ctx, rhythm, unitStart, stepsPerBar, state);
      if (u === units - 1 && unitNotes.length > 0) {
        const last = unitNotes[unitNotes.length - 1];
        const chord = ctx.chordAt(last.start);
        const targetPc = rng.chance(0.7) ? chord.root : chord.pitchClasses[2] ?? chord.root;
        let p = last.pitch;
        for (let d = 0; d < 12; d++) {
          if (mod12(p - d) === targetPc) {
            p = p - d;
            break;
          }
          if (mod12(p + d) === targetPc) {
            p = p + d;
            break;
          }
        }
        last.pitch = clampRegister(p, ctx.cfg.melody.register[0], ctx.cfg.melody.register[1]);
        last.dur = Math.max(last.dur, sectionStart + sectionTicks - last.start - 20);
        last.vel = 104;
      }
      sectionNotes.push(...unitNotes);
    }
    const clipped = sectionNotes.filter((n) => n.start < sectionStart + sectionTicks);
    for (const n of clipped) {
      n.dur = Math.min(n.dur, sectionStart + sectionTicks - n.start);
    }
    cache.set(sectionKey(section), clipped.map((n) => ({ ...n, start: n.start - sectionStart })));
    notes.push(...clipped);
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};

// src/core/genres/keygen.ts
var FOUR_ON_FLOOR = {
  name: "four-on-floor",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.9, 0, 0.6, 0, 0.9, 0, 0.6, 0, 0.9, 0, 0.6, 0, 0.9, 0, 0.6, 0.4],
  hatOpen: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
};
var DRIVING_8S = {
  name: "driving-8s",
  kick: [1, 0, 0, 0, 0, 0, 0.7, 0, 1, 0, 0.6, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.5],
  hatClosed: [0.9, 0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.5, 0.9, 0.5, 0.7, 0.5]
};
var HALFTIME_BREAK = {
  name: "halftime-break",
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0.9, 0, 0.5, 0, 0.9, 0, 0, 0, 0.9, 0, 0.5, 0, 0.9, 0, 0, 0],
  hatOpen: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]
};
var STEP2 = PPQ / 4;
function buildMotif(rng, syncopation, restProb, stepsPerBar) {
  const onsets = [0];
  for (let s = 1; s < stepsPerBar; s++) {
    const w = s % 4 === 0 ? 0.6 : s % 2 === 0 ? 0.42 : 0.32 * syncopation;
    if (rng.next() < w) onsets.push(s);
  }
  const cells = [];
  let prev = null;
  let usedOct = false;
  for (let i = 0; i < onsets.length; i++) {
    const step = onsets[i];
    let durSteps = (onsets[i + 1] ?? stepsPerBar) - step;
    if (rng.chance(restProb)) durSteps = Math.max(1, Math.ceil(durSteps / 2));
    let cell;
    if (prev && rng.chance(0.4)) {
      cell = { ...prev, step, durSteps };
    } else {
      const oct = !usedOct && rng.chance(0.25) ? 1 : 0;
      if (oct) usedOct = true;
      cell = {
        step,
        durSteps,
        ct: rng.pick([0, 1, 2]),
        shift: rng.chance(0.18) ? rng.chance(0.5) ? 1 : -1 : 0,
        oct
      };
    }
    cells.push(cell);
    prev = cell;
  }
  return cells;
}
function makeResponse(call) {
  const resp = call.map((c) => ({ ...c }));
  const last = resp[resp.length - 1];
  if (last) {
    last.ct = 0;
    last.shift = 0;
    last.oct = 0;
  }
  return resp;
}
function nearestPc(pc, prev, lo, hi) {
  let best = -1;
  for (let p = lo; p <= hi; p++) {
    if (mod12(p) === pc && (best < 0 || Math.abs(p - prev) < Math.abs(best - prev))) best = p;
  }
  return best < 0 ? prev : best;
}
var genKeygenLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const { register, syncopation, restProb } = ctx.cfg.melody;
  const [lo, hi] = register;
  const tonic = ctx.key.tonic;
  const mode = ctx.cfg.melody.scale ?? ctx.key.mode;
  const stepsPerBar = Math.round(ctx.barTicks / STEP2);
  const cache = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    const sectionStart = section.startBar * ctx.barTicks;
    const sectionEnd = sectionStart + section.bars * ctx.barTicks;
    const cached = cache.get(section.name);
    if (cached) {
      notes.push(...cached.map((n) => ({ ...n, start: n.start + sectionStart })));
      continue;
    }
    const call = buildMotif(rng, syncopation, restProb, stepsPerBar);
    const response = makeResponse(call);
    const anchor = { pitch: Math.round((lo + hi) / 2) };
    const sectionNotes = [];
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = sectionStart + bar * ctx.barTicks;
      const motif = bar % 2 === 0 ? call : response;
      const lastOfPhrase = bar % 4 === 3 || bar === section.bars - 1;
      const useRun = lastOfPhrase && rng.chance(0.3);
      const cells = useRun ? motif.filter((m) => m.step < stepsPerBar - 6) : motif;
      for (const m of cells) {
        const tick = barStart + m.step * STEP2;
        const chord = ctx.chordAt(tick);
        const pc = chord.pitchClasses[m.ct % chord.pitchClasses.length] ?? chord.root;
        let pitch = nearestPc(pc, anchor.pitch, lo, hi);
        if (m.shift !== 0) pitch = clampRegister(nextScalePitch(pitch, m.shift, tonic, mode), lo, hi);
        if (m.oct === 1 && pitch + 12 <= hi) pitch += 12;
        anchor.pitch = pitch;
        sectionNotes.push({
          pitch,
          start: tick,
          dur: Math.max(30, m.durSteps * STEP2 - 20),
          vel: m.step % 8 === 0 ? rng.int(96, 110) : rng.int(78, 94)
        });
      }
      if (useRun) {
        const runStart = stepsPerBar - 6;
        const target = nearestPc(ctx.chordAt(barStart + ctx.barTicks).root, anchor.pitch, lo, hi);
        const dir = target >= anchor.pitch ? 1 : -1;
        let p = anchor.pitch;
        for (let i = 0; i < 6; i++) {
          p = clampRegister(nextScalePitch(p, dir, tonic, mode), lo, hi);
          sectionNotes.push({
            pitch: p,
            start: barStart + (runStart + i) * STEP2,
            dur: STEP2 - 15,
            vel: 72 + i * 5
          });
        }
        anchor.pitch = p;
      }
    }
    const last = sectionNotes[sectionNotes.length - 1];
    if (last) {
      const chord = ctx.chordAt(last.start);
      const targetPc = rng.chance(0.7) ? chord.root : chord.pitchClasses[2] ?? chord.root;
      last.pitch = nearestPc(targetPc, last.pitch, lo, hi);
      last.dur = Math.max(last.dur, sectionEnd - last.start - 20);
      last.vel = 104;
    }
    for (let i = 1; i < sectionNotes.length; i++) {
      const n = sectionNotes[i];
      const prev = sectionNotes[i - 1];
      if (prev.start >= n.start || Math.abs(n.pitch - prev.pitch) < 7) continue;
      if (!rng.chance(0.35)) continue;
      let c = i - 1;
      while (c >= 0 && sectionNotes[c].slide) c--;
      const carrier = c >= 0 ? sectionNotes[c] : null;
      if (!carrier || carrier.start >= n.start) continue;
      n.slide = true;
      carrier.dur = Math.max(carrier.dur, n.start + n.dur - carrier.start);
    }
    const clipped = sectionNotes.filter((n) => n.start < sectionEnd);
    for (const n of clipped) n.dur = Math.min(n.dur, sectionEnd - n.start);
    cache.set(section.name, clipped.map((n) => ({ ...n, start: n.start - sectionStart })));
    notes.push(...clipped);
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
var KEYGEN = {
  id: "keygen",
  name: "Classic Keygen",
  naming: {
    patterns: [
      { w: 3, v: "{adj}_{noun}.{ext}" },
      { w: 2, v: "{adj} {noun} [{crew}]" },
      { w: 2, v: "{noun}_{noun2}.{ext}" },
      { w: 1, v: "[{crew}] {adj} {noun}" }
    ],
    words: {
      adj: ["NEON", "SERIAL", "CRACKED", "BINARY", "PHANTOM", "TURBO", "CHROME", "PIXEL", "ACID", "RADICAL", "QUANTUM", "STATIC", "MIDNIGHT", "ELECTRIC", "DIGITAL", "GHOST"],
      noun: ["OVERRIDE", "DREAMS", "PROTOCOL", "KEYGEN", "CIRCUIT", "INJECTION", "CASCADE", "FIREWALL", "PAYLOAD", "SECTOR", "MAINFRAME", "UNLOCKER", "RIPPER", "VECTOR", "CRYPT", "LOADER"],
      crew: ["rZr", "CORE", "FFF", "SKYLINE", "PARADOX", "DEVIANCE", "MYTH", "ECHO"],
      ext: ["EXE", "NFO", "DLL", "SYS", "ZIP"]
    }
  },
  bpm: [140, 180],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 9 },
    // A
    { w: 2, v: 0 },
    // C
    { w: 2, v: 2 },
    // D
    { w: 2, v: 4 },
    // E
    { w: 1, v: 7 },
    // G
    { w: 1, v: 5 }
    // F
  ],
  modes: [
    { w: 3, v: "naturalMinor" },
    { w: 1, v: "dorian" },
    { w: 1, v: "major" }
  ],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 },
        { name: "outro", bars: 2 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 2 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 },
        { name: "outro", bars: 2 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "break", bars: 4 },
        { name: "A", bars: 8 },
        { name: "outro", bars: 2 }
      ]
    }
  ],
  progressions: [
    // Degrees are 0-based: in minor 0=i, 5=VI, 2=III, 6=VII, 4=v/V.
    { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 1, v: [{ degree: 0, beats: 8 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] },
    // Andalusian descent into a hard major V — the harmonic-minor cracktro cadence.
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4, quality: "maj" }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }, { degree: 4, beats: 4, quality: "maj" }] },
    // Hypnotic two-chord vamp.
    { w: 1, v: [{ degree: 0, beats: 8 }, { degree: 5, beats: 8 }] },
    // Fast harmonic rhythm: two beats per chord.
    { w: 2, v: [{ degree: 0, beats: 2 }, { degree: 0, beats: 2 }, { degree: 5, beats: 2 }, { degree: 6, beats: 2 }, { degree: 0, beats: 2 }, { degree: 2, beats: 2 }, { degree: 5, beats: 2 }, { degree: 6, beats: 2 }] },
    // Suspension release: Vsus4 → V major.
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 2, quality: "sus4" }, { degree: 4, beats: 2, quality: "maj" }] }
  ],
  distinctProgressions: true,
  melody: {
    register: [69, 93],
    // A4–A6
    density: 0.6,
    leapProb: 0.22,
    restProb: 0.12,
    syncopation: 0.45
  },
  bass: {
    style: "octave8",
    styles: [
      { w: 3, v: "octave8" },
      { w: 2, v: "syncopated16" },
      { w: 1, v: "synth8" }
    ],
    register: [31, 55]
    // G1–G3: a full octave above every root, so octave8 always bounces
  },
  arp: {
    register: [57, 84],
    rate: 8,
    // 32nd-note tracker arps
    patterns: [
      { w: 3, v: "up" },
      { w: 2, v: "updown" },
      { w: 2, v: "octaves" },
      { w: 1, v: "down" },
      { w: 1, v: "thumb" }
    ]
  },
  drums: {
    patterns: [
      { w: 2, v: FOUR_ON_FLOOR },
      { w: 1, v: DRIVING_8S },
      { w: 1, v: HALFTIME_BREAK }
    ],
    fillEvery: 8,
    fillStyle: "rush"
  },
  instruments: {
    lead: { program: 80, name: "Square Lead" },
    arp: { program: 81, name: "Saw Arp" },
    bass: { program: 38, name: "Synth Bass" },
    drums: { program: 0, name: "Drums" }
  },
  arrange: {
    layers: {
      intro: ["arp", "drums"],
      break: ["arp", "bass"],
      outro: ["arp", "bass", "drums"]
    },
    sectionVelocity: { intro: 0.85, break: 0.8, outro: 0.9 }
  },
  humanize: { timingTicks: 3, velocity: 0.06 },
  // machine-tight, it's a tracker
  filterAutomation: {
    // Cracktro staple: the arp fades in through an opening filter.
    target: "arp",
    open: 4800,
    sections: {
      intro: { move: "sweep", fromHz: 600 },
      outro: { move: "closed", hz: 1400 }
      // duck under before the loop seam
    }
  },
  hooks: {
    melody: genKeygenLead
  }
};

// src/core/theory/chords.ts
var mod122 = (n) => (n % 12 + 12) % 12;
var QUALITY_INTERVALS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim7: [0, 3, 6, 9],
  halfDim7: [0, 3, 6, 10]
};
function chordFromDegree(tonic, mode, degree, opts = {}) {
  const intervals = SCALE_INTERVALS[mode];
  const n = intervals.length;
  const at = (d) => mod122(tonic + intervals[(d % n + n) % n] + 12 * Math.floor(d / n));
  const root = at(degree);
  const quality = opts.quality ?? "diatonic";
  if (quality !== "diatonic") {
    const pcs2 = QUALITY_INTERVALS[quality].map((iv) => mod122(root + iv));
    if (opts.ninth) pcs2.push(at(degree + 8));
    return { root, pitchClasses: pcs2, degree };
  }
  const steps = [0, 2, 4];
  if (opts.seventh || opts.ninth) steps.push(6);
  if (opts.ninth) steps.push(8);
  const pcs = [];
  for (const s of steps) {
    const pc = at(degree + s);
    if (!pcs.includes(pc)) pcs.push(pc);
  }
  return { root, pitchClasses: pcs, degree };
}
function closeVoicing(chord, lowest) {
  const start = (() => {
    for (let p = lowest; p < lowest + 12; p++) {
      if (mod122(p) === chord.root) return p;
    }
    return lowest;
  })();
  let prev = start;
  return chord.pitchClasses.map((pc, i) => {
    if (i === 0) return start;
    let p = prev + 1;
    while (mod122(p) !== pc) p++;
    prev = p;
    return p;
  });
}

// src/core/gen/drums.ts
var GM_DRUMS = {
  kick: 36,
  snare: 38,
  hatClosed: 42,
  hatOpen: 46,
  crash: 49,
  ride: 51,
  tambourine: 54,
  clap: 39,
  shaker: 70,
  tomLow: 45,
  tomMid: 47,
  tomHigh: 50,
  cowbell: 56
};
var STEPS_PER_BAR = 16;
function laneNotes(pattern, lane, barStart, stepTicks, skipFrom, rng, skipSteps) {
  const accents = pattern[lane];
  if (!accents) return [];
  const notes = [];
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    if (s >= skipFrom) break;
    if (skipSteps?.has(s)) continue;
    const accent = accents[s] ?? 0;
    if (accent <= 0) continue;
    if (accent < 1 && rng.chance(0.08)) continue;
    if (lane === "hatClosed" && pattern.hatOpen && (pattern.hatOpen[s] ?? 0) > 0) continue;
    notes.push({
      pitch: GM_DRUMS[lane],
      start: barStart + s * stepTicks,
      dur: Math.max(30, Math.floor(stepTicks / 2)),
      vel: Math.min(127, Math.round(45 + accent * 70) + rng.int(-4, 4))
    });
  }
  return notes;
}
var genDrums = (ctx) => {
  const inst = ctx.cfg.instruments.drums;
  if (!inst) return null;
  const rng = ctx.rng("drums");
  const stepTicks = ctx.barTicks / STEPS_PER_BAR;
  const patternByName = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    let pattern = patternByName.get(sectionKey(section));
    if (!pattern) {
      pattern = rng.weighted(ctx.cfg.drums.patterns);
      patternByName.set(sectionKey(section), pattern);
    }
    notes.push({
      pitch: GM_DRUMS.crash,
      start: section.startBar * ctx.barTicks,
      dur: ctx.beatTicks,
      vel: 100
    });
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = (section.startBar + bar) * ctx.barTicks;
      const isFillBar = (bar + 1) % ctx.cfg.drums.fillEvery === 0 || bar === section.bars - 1;
      const skipFrom = isFillBar ? 12 : STEPS_PER_BAR;
      const rollSteps = /* @__PURE__ */ new Set();
      if (ctx.cfg.drums.rollProb && !isFillBar && rng.chance(ctx.cfg.drums.rollProb)) {
        const rollStep = rng.int(2, 13);
        rollSteps.add(rollStep);
        rollSteps.add(rollStep + 1);
        const t32 = stepTicks / 2;
        for (let i = 0; i < 4; i++) {
          notes.push({
            pitch: GM_DRUMS.hatClosed,
            start: barStart + rollStep * stepTicks + i * t32,
            dur: 25,
            vel: 48 + i * 9
          });
        }
      }
      notes.push(
        ...laneNotes(pattern, "kick", barStart, stepTicks, skipFrom, rng),
        ...laneNotes(pattern, "snare", barStart, stepTicks, skipFrom, rng),
        ...laneNotes(pattern, "hatClosed", barStart, stepTicks, skipFrom, rng, rollSteps),
        ...laneNotes(pattern, "hatOpen", barStart, stepTicks, skipFrom, rng, rollSteps)
      );
      if (!isFillBar && rng.chance(0.07)) {
        notes.push({
          pitch: GM_DRUMS.snare,
          start: barStart + (rng.chance(0.5) ? 7 : 15) * stepTicks,
          dur: 30,
          vel: rng.int(20, 32)
        });
      }
      if (isFillBar) {
        const fillStyle = ctx.cfg.drums.fillStyle ?? "toms";
        const rush = fillStyle === "rush" || fillStyle === "mixed" && rng.chance(0.5);
        if (rush) {
          const t32 = stepTicks / 2;
          for (let i = 0; i < 8; i++) {
            notes.push({
              pitch: GM_DRUMS.snare,
              start: barStart + 12 * stepTicks + i * t32,
              dur: 25,
              vel: Math.min(110, 50 + i * 9)
            });
          }
        } else {
          const useToms = rng.chance(0.4);
          const fillPitches = useToms ? [GM_DRUMS.tomHigh, GM_DRUMS.tomMid, GM_DRUMS.tomLow, GM_DRUMS.snare] : [GM_DRUMS.snare, GM_DRUMS.snare, GM_DRUMS.snare, GM_DRUMS.snare];
          for (let i = 0; i < 4; i++) {
            notes.push({
              pitch: fillPitches[i],
              start: barStart + (12 + i) * stepTicks,
              dur: Math.max(30, Math.floor(stepTicks / 2)),
              vel: 70 + i * 13
            });
          }
        }
      }
    }
  }
  return {
    name: inst.name,
    channel: DRUM_CHANNEL,
    program: inst.program,
    role: "drums",
    notes
  };
};

// src/core/genres/noir.ts
var ticksPerMs = (bpm) => PPQ * bpm / 6e4;
function placeLow(pc, lo, hi) {
  for (let p = lo; p <= hi; p++) {
    if (mod12(p) === pc) return p;
  }
  return lo;
}
function nearestPc2(pc, around, lo, hi) {
  let best = placeLow(pc, lo, hi);
  for (let p = lo; p <= hi; p++) {
    if (mod12(p) === pc && Math.abs(p - around) < Math.abs(best - around)) best = p;
  }
  return best;
}
var genNoirDrums = (ctx) => {
  const inst = ctx.cfg.instruments.drums;
  if (!inst) return null;
  const rng = ctx.rng("drums");
  const beat = ctx.beatTicks;
  const notes = [];
  for (const section of ctx.sections) {
    if (section.name === "outro") continue;
    const sStart = section.startBar * ctx.barTicks;
    for (let bar = 0; bar < section.bars; bar++) {
      const b0 = sStart + bar * ctx.barTicks;
      const firstBar = section.name === "intro" && bar === 0;
      if (!firstBar && rng.chance(section.name === "intro" ? 0.7 : 0.85)) {
        notes.push({ pitch: GM_DRUMS.kick, start: b0, dur: 200, vel: rng.int(38, 48) });
      }
      if (section.name === "intro") continue;
      notes.push(
        { pitch: GM_DRUMS.snare, start: b0 + beat, dur: 120, vel: rng.int(40, 60) },
        { pitch: GM_DRUMS.snare, start: b0 + 3 * beat, dur: 120, vel: rng.int(40, 60) }
      );
      for (let q = 0; q < 4; q++) {
        notes.push({ pitch: GM_DRUMS.ride, start: b0 + q * beat, dur: 200, vel: rng.int(48, 56) });
        if (q === 1 || q === 3) {
          notes.push({ pitch: GM_DRUMS.ride, start: b0 + q * beat + beat / 2, dur: 140, vel: rng.int(34, 42) });
        }
      }
      if (section.name === "dev" && rng.chance(0.25)) {
        notes.push({ pitch: GM_DRUMS.snare, start: b0 + rng.pick([1.5, 2.5, 3.5]) * beat, dur: 80, vel: rng.int(22, 32) });
      }
    }
  }
  return { name: inst.name, channel: DRUM_CHANNEL, program: inst.program, role: "drums", notes };
};
var genNoirBass = (ctx) => {
  const inst = ctx.cfg.instruments.bass;
  if (!inst) return null;
  const rng = ctx.rng("bass");
  const [lo, hi] = ctx.cfg.bass.register;
  const beat = ctx.beatTicks;
  const notes = [];
  let prev = placeLow(ctx.key.tonic, lo, hi);
  for (const section of ctx.sections) {
    if (section.name === "outro") continue;
    const sStart = section.startBar * ctx.barTicks;
    for (let bar = 0; bar < section.bars; bar++) {
      const b0 = sStart + bar * ctx.barTicks;
      const chord = ctx.chordAt(b0);
      if (section.name === "intro") {
        if (bar >= Math.floor(section.bars / 2)) {
          notes.push({ pitch: placeLow(ctx.key.tonic, lo, hi), start: b0, dur: ctx.barTicks - 40, vel: rng.int(54, 62) });
        }
        continue;
      }
      if (section.name === "A") {
        const root = nearestPc2(chord.root, prev, lo, hi);
        prev = root;
        notes.push({ pitch: root, start: b0, dur: 2 * beat - 40, vel: rng.int(62, 72) });
        if (rng.chance(0.35)) {
          const fifth = nearestPc2(chord.pitchClasses[2] ?? chord.root, prev, lo, hi);
          notes.push({ pitch: fifth, start: b0 + 2 * beat, dur: 2 * beat - 60, vel: rng.int(54, 64) });
        }
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const tick = b0 + q * beat;
        const here = ctx.chordAt(tick);
        const next = ctx.chordAt(tick + beat);
        let pc;
        if (q === 0) pc = here.root;
        else if (q === 1) pc = here.pitchClasses[1] ?? here.root;
        else if (q === 2) pc = here.pitchClasses[2] ?? here.root;
        else if (next.root !== here.root) {
          const target = nearestPc2(next.root, prev, lo, hi);
          const approach = target + (rng.chance(0.5) ? 1 : -1);
          prev = Math.min(hi, Math.max(lo, approach));
          notes.push({ pitch: prev, start: tick, dur: beat - 50, vel: rng.int(86, 94) });
          continue;
        } else pc = here.pitchClasses[3] ?? here.pitchClasses[1] ?? here.root;
        prev = nearestPc2(pc, prev, lo, hi);
        const accent = q === 1 || q === 3;
        notes.push({ pitch: prev, start: tick, dur: beat - 50, vel: rng.int(accent ? 84 : 72, accent ? 94 : 80) });
      }
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "bass", notes };
};
var genNoirComp = (ctx) => {
  const inst = ctx.cfg.instruments.chords;
  if (!inst) return null;
  const rng = ctx.rng("comping");
  const beat = ctx.beatTicks;
  const strumTick = () => Math.round(rng.int(10, 20) * ticksPerMs(ctx.bpm));
  const notes = [];
  for (const section of ctx.sections) {
    if (section.name === "intro" || section.name === "outro") continue;
    const sStart = section.startBar * ctx.barTicks;
    for (let bar = 0; bar < section.bars; bar++) {
      const b0 = sStart + bar * ctx.barTicks;
      const hitCount = section.name === "dev" ? rng.int(2, 3) : rng.chance(0.35) ? 2 : 1;
      const positions = rng.shuffle([1.5, 2.5, 0.5, 2, 3]).slice(0, hitCount).sort((a, b) => a - b);
      for (const pos of positions) {
        const tick = b0 + Math.round(pos * beat);
        const chord = ctx.chordAt(tick);
        const voicing = closeVoicing(chord, 56);
        if (voicing.length >= 4) {
          voicing[voicing.length - 2] = voicing[voicing.length - 2] - 12;
          voicing.sort((a, b) => a - b);
        }
        const ringUntil = b0 + ctx.barTicks + beat;
        let strum = 0;
        for (const pitch of voicing) {
          notes.push({
            pitch,
            start: tick + strum,
            dur: Math.max(beat, ringUntil - tick - strum),
            vel: rng.int(46, 62)
          });
          strum += strumTick();
        }
      }
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "chords", notes };
};
var genNoirLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const beat = ctx.beatTicks;
  const tpm = ticksPerMs(ctx.bpm);
  const rubato = () => Math.round(rng.int(10, 40) * tpm);
  const { tonic } = ctx.key;
  const notes = [];
  const stepScale = (p, dir) => {
    let q = p + dir;
    while (!inScale(q, tonic, "blues")) q += dir;
    return q;
  };
  const clampReg2 = (p, lo, hi) => {
    while (p > hi) p -= 12;
    while (p < lo) p += 12;
    return p;
  };
  let pitch = clampReg2(placeLow(tonic, 68, 80), 62, 84);
  for (const section of ctx.sections) {
    const sStart = section.startBar * ctx.barTicks;
    if (section.name === "intro") continue;
    if (section.name === "outro") {
      const chord = ctx.chordAt(sStart);
      const last = clampReg2(nearestPc2(rng.chance(0.6) ? chord.root : chord.pitchClasses[2] ?? chord.root, pitch, 62, 84), 62, 84);
      notes.push({
        pitch: last,
        start: sStart + rubato(),
        dur: Math.min(2 * ctx.barTicks, section.bars * ctx.barTicks) - beat,
        vel: 72
      });
      continue;
    }
    const isDev = section.name === "dev";
    const [lo, hi] = isDev ? [70, 86] : [62, 84];
    pitch = clampReg2(pitch, lo, hi);
    let bar = 0;
    while (bar < section.bars) {
      const phraseLen = Math.min(rng.int(2, 3), section.bars - bar);
      for (let pb = 0; pb < phraseLen; pb++) {
        const b0 = sStart + (bar + pb) * ctx.barTicks;
        const lastBarOfPhrase = pb === phraseLen - 1;
        if (isDev && rng.chance(0.35)) {
          const startBeat = rng.int(0, 1);
          const count = rng.int(4, 6);
          const dir = rng.chance(0.6) ? 1 : -1;
          for (let i = 0; i < count; i++) {
            pitch = clampReg2(stepScale(pitch, dir), lo, hi);
            notes.push({
              pitch,
              start: b0 + startBeat * beat + Math.round(i * beat / 3) + rubato(),
              dur: Math.round(beat / 3) - 20,
              vel: rng.int(78, 90)
            });
          }
          continue;
        }
        const onsetCount = rng.int(2, lastBarOfPhrase ? 3 : 4);
        const slots = rng.shuffle([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]).slice(0, onsetCount).sort((a, b) => a - b);
        for (let i = 0; i < slots.length; i++) {
          const tick = b0 + Math.round(slots[i] * beat);
          const chord = ctx.chordAt(tick);
          const strong = slots[i] % 1 === 0;
          if (strong || rng.chance(0.3)) {
            pitch = clampReg2(nearestPc2(rng.pick(chord.pitchClasses), pitch, lo, hi), lo, hi);
          } else {
            pitch = clampReg2(stepScale(pitch, rng.chance(0.5) ? 1 : -1), lo, hi);
          }
          const nextSlot = slots[i + 1];
          const isPhraseEnd = lastBarOfPhrase && i === slots.length - 1;
          const until = nextSlot !== void 0 ? b0 + Math.round(nextSlot * beat) : b0 + ctx.barTicks;
          const dur = isPhraseEnd ? ctx.barTicks : Math.min(until - tick - 20, 2 * beat);
          notes.push({
            pitch,
            start: tick + rubato(),
            dur: Math.max(120, dur),
            vel: rng.int(isPhraseEnd ? 84 : 72, isPhraseEnd ? 96 : 90)
          });
        }
      }
      bar += phraseLen + rng.int(1, 2);
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
var NOIR = {
  id: "noir",
  name: "Noir",
  naming: {
    patterns: [
      { w: 2, v: "{adj} {noun}" },
      { w: 2, v: "The {adj} {noun}" },
      { w: 2, v: "{noun} in {place}" },
      { w: 1, v: "Last Train to {place}" },
      { w: 1, v: "Smoke over {place}" },
      { w: 1, v: "{noun} & {noun2}" }
    ],
    words: {
      adj: ["Smoky", "Velvet", "Midnight", "Crooked", "Hollow", "Bitter", "Pale", "Rain-Slick", "Borrowed", "Lonesome", "Faded", "Sleepless"],
      noun: ["Alley", "Dame", "Trenchcoat", "Cigarette", "Streetlight", "Saxophone", "Motel", "Verdict", "Alibi", "Goodbye", "Whiskey", "Shadow"],
      place: ["Nowhere", "the Docks", "Room 9", "the Last Bar", "Union Station", "the Rain", "Downtown", "the Morgue"]
    }
  },
  bpm: [60, 80],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 2 },
    // D
    { w: 2, v: 7 },
    // G
    { w: 2, v: 0 },
    // C
    { w: 1, v: 9 },
    // A
    { w: 1, v: 4 }
    // E
  ],
  modes: [
    { w: 2, v: "dorian" },
    { w: 1, v: "naturalMinor" }
  ],
  swing: [0.85, 1],
  // ≈63–67% — full shuffle drag
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 2 },
        { name: "A", bars: 8 },
        { name: "dev", bars: 8 },
        { name: "B", bars: 8 },
        { name: "outro", bars: 2 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 2 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "dev", bars: 8 },
        { name: "B", bars: 8 },
        { name: "outro", bars: 2 }
      ]
    }
  ],
  progressions: [
    // Extended chords only — min7/min9/ø7/dom7, never plain triads.
    {
      w: 3,
      v: [
        { degree: 0, beats: 4, seventh: true, ninth: true },
        { degree: 3, beats: 4, seventh: true },
        { degree: 1, beats: 4, quality: "halfDim7" },
        { degree: 4, beats: 4, quality: "dom7" }
      ]
    },
    {
      w: 2,
      v: [
        { degree: 0, beats: 8, seventh: true, ninth: true },
        { degree: 3, beats: 4, seventh: true },
        { degree: 4, beats: 4, quality: "dom7" }
      ]
    },
    {
      w: 2,
      v: [
        { degree: 0, beats: 4, seventh: true },
        { degree: 5, beats: 4, seventh: true },
        { degree: 1, beats: 4, quality: "halfDim7" },
        { degree: 4, beats: 4, quality: "dom7" }
      ]
    }
  ],
  melody: {
    register: [62, 84],
    density: 0.3,
    leapProb: 0.3,
    restProb: 0.3,
    syncopation: 0.3,
    scale: "blues"
    // the signature ache — used by the custom lead too
  },
  bass: { style: "walking", register: [36, 55] },
  comping: { register: [55, 78] },
  drums: {
    patterns: [],
    // custom generator
    fillEvery: 8
  },
  instruments: {
    lead: { program: 59, name: "Muted Trumpet" },
    bass: { program: 32, name: "Upright Bass" },
    chords: { program: 11, name: "Vibraphone" },
    drums: { program: 0, name: "Brushes" }
  },
  arrange: {
    layers: {},
    sectionVelocity: { intro: 0.9, dev: 1, outro: 0.85 }
  },
  humanize: { timingTicks: 8, velocity: 0.18 },
  // the soloist adds its own rubato on top
  filterAutomation: {
    // Old radio warming up: muffled intro opens into the room.
    target: "master",
    open: 11e3,
    sections: {
      intro: { move: "sweep", fromHz: 1800 }
    }
  },
  hooks: {
    drums: genNoirDrums,
    bass: genNoirBass,
    comping: genNoirComp,
    melody: genNoirLead
  }
};

// src/core/genres/grime.ts
var TRAP_HALFTIME = {
  name: "trap-halftime",
  kick: [1, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0.6, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0.9, 0, 0.5, 0, 0.7, 0, 0.5, 0.4, 0.9, 0, 0.5, 0, 0.7, 0, 0.5, 0]
};
var TRAP_BUSY = {
  name: "trap-busy",
  kick: [1, 0, 0, 0.6, 0, 0, 1, 0, 0, 0, 0, 0.6, 0, 0.7, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.4],
  hatClosed: [0.9, 0.4, 0.5, 0.4, 0.7, 0.4, 0.5, 0.4, 0.9, 0.4, 0.5, 0.4, 0.7, 0.4, 0.5, 0.4],
  hatOpen: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]
};
var STEP3 = PPQ / 4;
var UNIT_BARS2 = 2;
function buildOstinato(rng, stepsPerBar) {
  const total = UNIT_BARS2 * stepsPerBar;
  const onsets = [0];
  for (let s = 1; s < total; s++) {
    const inBar = s % stepsPerBar;
    const w = inBar === 0 ? 0.5 : inBar % 4 === 0 ? 0.35 : inBar % 2 === 0 ? 0.26 : 0.3;
    if (rng.next() < w) onsets.push(s);
  }
  const cells = [];
  let prev = null;
  for (let i = 0; i < onsets.length; i++) {
    const step = onsets[i];
    let durSteps = (onsets[i + 1] ?? total) - step;
    if (rng.chance(0.3)) durSteps = Math.max(1, Math.ceil(durSteps / 2));
    let cell;
    if (prev && rng.chance(0.55)) {
      cell = { ...prev, step, durSteps };
    } else {
      cell = {
        step,
        durSteps,
        ct: rng.pick([0, 0, 1, 2]),
        shift: rng.chance(0.12) ? rng.chance(0.5) ? 1 : -1 : 0,
        drop: rng.chance(0.18)
      };
    }
    cells.push(cell);
    prev = cell;
  }
  return cells;
}
function nearestPc3(pc, prev, lo, hi) {
  let best = -1;
  for (let p = lo; p <= hi; p++) {
    if (mod12(p) === pc && (best < 0 || Math.abs(p - prev) < Math.abs(best - prev))) best = p;
  }
  return best < 0 ? prev : best;
}
var genGrimeLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const [lo, hi] = ctx.cfg.melody.register;
  const tonic = ctx.key.tonic;
  const mode = ctx.key.mode;
  const stepsPerBar = Math.round(ctx.barTicks / STEP3);
  const unitTicks = UNIT_BARS2 * ctx.barTicks;
  const cache = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    const sectionStart = section.startBar * ctx.barTicks;
    const sectionEnd = sectionStart + section.bars * ctx.barTicks;
    const cached = cache.get(sectionKey(section));
    if (cached) {
      notes.push(...cached.map((n) => ({ ...n, start: n.start + sectionStart })));
      continue;
    }
    const base = buildOstinato(rng, stepsPerBar);
    const varied = base.length > 2 ? base.slice(0, base.length - 1) : base;
    const anchor = { pitch: Math.round((lo + hi) / 2) };
    const units = Math.ceil(section.bars / UNIT_BARS2);
    const sectionNotes = [];
    for (let u = 0; u < units; u++) {
      const unitStart = sectionStart + u * unitTicks;
      const cells = u % 2 === 1 ? varied : base;
      for (const m of cells) {
        const tick = unitStart + m.step * STEP3;
        if (tick >= sectionEnd) break;
        const chord = ctx.chordAt(tick);
        const pc = chord.pitchClasses[m.ct % chord.pitchClasses.length] ?? chord.root;
        let pitch = nearestPc3(pc, anchor.pitch, lo, hi);
        if (m.shift !== 0) pitch = clampRegister(nextScalePitch(pitch, m.shift, tonic, mode), lo, hi);
        if (m.drop && pitch - 12 >= lo) pitch -= 12;
        anchor.pitch = pitch;
        sectionNotes.push({
          pitch,
          start: tick,
          dur: Math.max(30, m.durSteps * STEP3 - 30),
          vel: m.step % 8 === 0 ? rng.int(92, 106) : rng.int(72, 88)
        });
      }
    }
    const last = sectionNotes[sectionNotes.length - 1];
    if (last) {
      last.pitch = nearestPc3(ctx.chordAt(last.start).root, last.pitch, lo, hi);
      last.dur = Math.max(last.dur, Math.min(sectionEnd - last.start - 20, ctx.barTicks / 2));
      last.vel = 100;
    }
    const clipped = sectionNotes.filter((n) => n.start < sectionEnd);
    for (const n of clipped) n.dur = Math.min(n.dur, sectionEnd - n.start);
    cache.set(sectionKey(section), clipped.map((n) => ({ ...n, start: n.start - sectionStart })));
    notes.push(...clipped);
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
var GRIME = {
  id: "grime",
  name: "Grime",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun}" },
      { w: 1, v: "{adj} {noun} (VIP)" },
      { w: 1, v: "140 {noun}" }
    ],
    words: {
      adj: ["Tower Block", "Roadside", "Grey Estate", "Pirate", "Concrete", "Endz", "Low Battery", "Night Bus", "Corner Shop", "Manor"],
      noun: ["Riddim", "Heat", "Cypher", "Static", "Dubplate", "Skank", "Pressure", "Bars", "Signal", "Wheel-Up"]
    }
  },
  bpm: [130, 145],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 1 },
    // C#
    { w: 2, v: 6 },
    // F#
    { w: 2, v: 9 },
    // A
    { w: 2, v: 2 },
    // D
    { w: 1, v: 7 }
    // G
  ],
  modes: [
    { w: 2, v: "naturalMinor" },
    { w: 1, v: "phrygian" }
  ],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "strip", bars: 4 },
        { name: "A", bars: 8 }
      ]
    }
  ],
  progressions: [
    // Dark vamps, two chords per 4 bars: i–VI, i–iv, phrygian i–bII.
    { w: 3, v: [{ degree: 0, beats: 8 }, { degree: 5, beats: 8 }] },
    { w: 2, v: [{ degree: 0, beats: 8 }, { degree: 3, beats: 8 }] },
    { w: 2, v: [{ degree: 0, beats: 8 }, { degree: 1, beats: 8 }] },
    { w: 1, v: [{ degree: 0, beats: 12 }, { degree: 6, beats: 4 }] },
    // Bar-rate rocking — twice the menace of the 8-beat vamps.
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 1, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 0, beats: 4 }, { degree: 5, beats: 4 }] },
    // Open sus2 drone colour over the pad.
    { w: 1, v: [{ degree: 0, beats: 8, quality: "sus2" }, { degree: 5, beats: 8 }] }
  ],
  distinctProgressions: true,
  melody: {
    register: [60, 76],
    // cowbell sits in one tight octave-and-a-bit
    density: 0.5,
    leapProb: 0.18,
    restProb: 0.22,
    syncopation: 0.6
  },
  bass: { style: "s808", register: [26, 41] },
  // D1–F2, sub territory
  comping: { register: [48, 65] },
  drums: {
    patterns: [
      { w: 2, v: TRAP_HALFTIME },
      { w: 1, v: TRAP_BUSY }
    ],
    fillEvery: 8,
    rollProb: 0.35,
    fillStyle: "mixed"
    // snare rushes half the time — trap, not rock toms
  },
  instruments: {
    lead: { program: 113, name: "Cowbell Lead" },
    // GM Agogo ≈ closest pitched cowbell
    bass: { program: 39, name: "808 Bass" },
    chords: { program: 89, name: "Dark Pad" },
    drums: { program: 0, name: "Trap Kit" }
  },
  arrange: {
    layers: {
      intro: ["bass", "drums"],
      strip: ["bass", "drums"]
      // the trap breakdown: sub + kit only
    },
    sectionVelocity: { intro: 0.9, strip: 0.95 }
  },
  humanize: { timingTicks: 6, velocity: 0.12 },
  filterAutomation: {
    // DJ filter-in: the whole mix opens up across the intro.
    target: "master",
    open: 9500,
    sections: {
      intro: { move: "sweep", fromHz: 900 }
    }
  },
  hooks: {
    melody: genGrimeLead
  }
};

// src/core/genres/anime.ts
var POP_ROCK = {
  name: "pop-rock",
  kick: [1, 0, 0, 0, 0, 0, 0.8, 0, 1, 0, 0, 0.6, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.9, 0, 0.6, 0, 0.9, 0, 0.6, 0, 0.9, 0, 0.6, 0, 0.9, 0, 0.6, 0],
  hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]
};
var POP_DRIVING = {
  name: "pop-driving",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.6, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.9, 0.5, 0.6, 0.5, 0.9, 0.5, 0.6, 0.5, 0.9, 0.5, 0.6, 0.5, 0.9, 0.5, 0.6, 0.5]
};
var ANIME = {
  id: "anime",
  name: "Anime Opening",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun}" },
      { w: 1, v: "Heart of the {adj} {noun}" },
      { w: 1, v: "{noun} Beyond the {noun2}" },
      { w: 1, v: "My {adj} {noun}" }
    ],
    words: {
      adj: ["Sakura", "Neon", "Crimson", "Shining", "Infinite", "Starlit", "Burning", "Crystal", "Midnight", "Eternal"],
      noun: ["Overdrive", "Horizon", "Heartbeat", "Wings", "Promise", "Adventure", "Tomorrow", "Galaxy", "Memories", "Destiny"]
    }
  },
  bpm: [128, 160],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 0 },
    // C
    { w: 2, v: 7 },
    // G
    { w: 2, v: 2 },
    // D
    { w: 2, v: 9 },
    // A
    { w: 1, v: 4 }
    // E
  ],
  modes: [{ w: 1, v: "major" }],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 2 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    }
  ],
  progressions: [
    // The royal road (王道進行): IV△7–V7–iii7–vi.
    {
      w: 3,
      v: [
        { degree: 3, beats: 4, seventh: true },
        { degree: 4, beats: 4, quality: "dom7" },
        { degree: 2, beats: 4, seventh: true },
        { degree: 5, beats: 4, seventh: true }
      ]
    },
    // I–V–vi–IV.
    {
      w: 2,
      v: [
        { degree: 0, beats: 4 },
        { degree: 4, beats: 4 },
        { degree: 5, beats: 4 },
        { degree: 3, beats: 4 }
      ]
    },
    // vi–IV–I–V.
    {
      w: 2,
      v: [
        { degree: 5, beats: 4 },
        { degree: 3, beats: 4 },
        { degree: 0, beats: 4 },
        { degree: 4, beats: 4 }
      ]
    }
  ],
  melody: {
    register: [67, 88],
    // bright, up top
    density: 0.6,
    leapProb: 0.32,
    // big J-pop leaps
    restProb: 0.1,
    syncopation: 0.45
  },
  bass: { style: "synth8", register: [33, 50] },
  comping: { register: [55, 76] },
  drums: {
    patterns: [
      { w: 2, v: POP_ROCK },
      { w: 1, v: POP_DRIVING }
    ],
    fillEvery: 4
    // energetic fills
  },
  instruments: {
    lead: { program: 1, name: "Bright Piano" },
    bass: { program: 33, name: "Finger Bass" },
    chords: { program: 48, name: "Strings" },
    drums: { program: 0, name: "Pop Kit" }
  },
  arrange: {
    layers: {
      intro: ["chords", "lead", "drums"]
    },
    sectionVelocity: { intro: 0.85 }
  },
  humanize: { timingTicks: 8, velocity: 0.12 }
};

// src/core/theory/progressions.ts
var BLUES_12BAR = [
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 3, beats: 4, quality: "dom7" },
  { degree: 3, beats: 4, quality: "dom7" },
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 4, beats: 4, quality: "dom7" },
  { degree: 3, beats: 4, quality: "dom7" },
  { degree: 0, beats: 4, quality: "dom7" },
  { degree: 4, beats: 4, quality: "dom7" }
];
function expandProgression(template, totalBeats) {
  const out = [];
  let beat = 0;
  while (beat < totalBeats) {
    for (const step of template) {
      if (beat >= totalBeats) break;
      const beats = Math.min(step.beats, totalBeats - beat);
      out.push({ ...step, beats, startBeat: beat });
      beat += beats;
    }
  }
  return out;
}

// src/core/genres/blues.ts
var SHUFFLE = {
  name: "shuffle",
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0]
};
var SHUFFLE_BUSY = {
  name: "shuffle-busy",
  kick: [1, 0, 0, 0, 0, 0, 0.6, 0, 0.9, 0, 0, 0, 0, 0, 0.5, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.35, 0, 0, 0, 0, 1, 0, 0, 0.4],
  hatClosed: [0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0, 0.8, 0, 0.5, 0]
};
var BLUES = {
  id: "blues",
  name: "Blues",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun} Blues" },
      { w: 1, v: "{noun} Blues" },
      { w: 1, v: "{adj} {noun} Boogie" },
      { w: 1, v: "Blues for a {adj} {noun}" }
    ],
    words: {
      adj: ["Dusty", "Empty", "Broken", "Lonesome", "Greyhound", "Crossroad", "Muddy", "Bourbon", "Rusty", "Delta"],
      noun: ["Road", "Bottle", "Heart", "Pocket", "Train", "Mornin'", "Levee", "Porch", "Dime", "Hound"]
    }
  },
  bpm: [80, 116],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 4 },
    // E
    { w: 3, v: 9 },
    // A
    { w: 2, v: 7 },
    // G
    { w: 1, v: 0 },
    // C
    { w: 1, v: 2 }
    // D
  ],
  modes: [{ w: 1, v: "mixolydian" }],
  swing: [0.5, 0.65],
  // hard shuffle
  structures: [
    {
      w: 2,
      v: [
        { name: "A", bars: 12 },
        { name: "A", bars: 12 },
        { name: "A", bars: 12 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "A", bars: 12 },
        { name: "A", bars: 12 },
        { name: "A", bars: 12 },
        { name: "A", bars: 12 }
      ]
    }
  ],
  progressions: [{ w: 1, v: BLUES_12BAR }],
  // the square is the square
  melody: {
    register: [60, 81],
    density: 0.42,
    leapProb: 0.25,
    restProb: 0.25,
    // breathing room — call and response
    syncopation: 0.4,
    scale: "blues"
    // blue notes over dom7 harmony
  },
  bass: { style: "boogie", register: [36, 55] },
  comping: { register: [55, 75] },
  drums: {
    patterns: [
      { w: 2, v: SHUFFLE },
      { w: 1, v: SHUFFLE_BUSY }
    ],
    fillEvery: 12
    // a fill per chorus, on the turnaround
  },
  instruments: {
    lead: { program: 22, name: "Harmonica" },
    bass: { program: 32, name: "Upright Bass" },
    chords: { program: 0, name: "Piano" },
    drums: { program: 0, name: "Shuffle Kit" }
  },
  arrange: {
    layers: {},
    sectionVelocity: {}
  },
  humanize: { timingTicks: 12, velocity: 0.18 }
};

// src/core/genres/military.ts
var PARADE_SNARE = {
  // 2/4 bar, steps are 32nds: continuous snare rudiments, kick on the downbeat.
  name: "parade-snare",
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0],
  snare: [1, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.9, 0, 0.4, 0, 0.6, 0, 0.4, 0.5],
  hatClosed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
var PARADE_ROLLS = {
  name: "parade-rolls",
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0],
  snare: [1, 0.3, 0.4, 0.3, 0.7, 0.3, 0.4, 0.3, 0.9, 0.3, 0.4, 0.3, 0.7, 0.3, 0.5, 0.6],
  hatClosed: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
};
var MILITARY = {
  id: "military",
  name: "Military Parade",
  naming: {
    patterns: [
      { w: 3, v: "March of the {adj} {noun}" },
      { w: 2, v: "Parade of the {adj} {noun}" },
      { w: 2, v: "{adj} {noun} March" },
      { w: 1, v: "The {adj} {noun}" }
    ],
    words: {
      adj: ["Iron", "Scarlet", "Granite", "Northern", "Unbroken", "Thundering", "Golden", "Steadfast"],
      noun: ["Column", "Banner", "Garrison", "Bugle", "Regiment", "Bastion", "Vanguard", "Standard", "Brigade", "Cadence"]
    }
  },
  bpm: [108, 124],
  timeSig: [2, 4],
  keys: [
    { w: 3, v: 10 },
    // Bb — band key
    { w: 3, v: 3 },
    // Eb
    { w: 2, v: 5 },
    // F
    { w: 1, v: 0 }
    // C
  ],
  modes: [{ w: 1, v: "major" }],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 16 },
        { name: "B", bars: 16 },
        { name: "A", bars: 16 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 8 },
        { name: "A", bars: 16 },
        { name: "B", bars: 16 },
        { name: "A", bars: 16 }
      ]
    }
  ],
  progressions: [
    // I–IV–V–I over 4 bars of 2/4 (8 beats).
    {
      w: 2,
      v: [
        { degree: 0, beats: 4 },
        { degree: 3, beats: 2 },
        { degree: 4, beats: 2 }
      ]
    },
    {
      w: 2,
      v: [
        { degree: 0, beats: 2 },
        { degree: 4, beats: 2 },
        { degree: 0, beats: 2 },
        { degree: 4, beats: 2 }
      ]
    },
    {
      w: 1,
      v: [
        { degree: 0, beats: 2 },
        { degree: 3, beats: 2 },
        { degree: 0, beats: 2 },
        { degree: 4, beats: 2 }
      ]
    }
  ],
  melody: {
    register: [64, 82],
    // trumpet
    density: 0.55,
    leapProb: 0.3,
    // fanfare fourths and fifths
    restProb: 0.12,
    syncopation: 0.12
    // straight, on the grid
  },
  bass: { style: "march", register: [34, 50] },
  // tuba oom-pah
  comping: { register: [55, 74], style: "stabs" },
  drums: {
    patterns: [
      { w: 2, v: PARADE_SNARE },
      { w: 1, v: PARADE_ROLLS }
    ],
    fillEvery: 8
  },
  instruments: {
    lead: { program: 56, name: "Trumpet" },
    bass: { program: 58, name: "Tuba" },
    chords: { program: 61, name: "Brass Section" },
    drums: { program: 0, name: "Field Drums" }
  },
  arrange: {
    layers: {
      intro: ["drums", "bass"]
      // drums-and-tuba street beat opening
    },
    sectionVelocity: { intro: 0.9 }
  },
  humanize: { timingTicks: 5, velocity: 0.1 }
};

// src/core/genres/darkacademia.ts
var NO_DRUMS = {
  name: "none",
  kick: [],
  snare: [],
  hatClosed: []
};
var DARKACADEMIA = {
  id: "darkacademia",
  name: "Dark Academia",
  naming: {
    patterns: [
      { w: 3, v: "{noun} for {obj}" },
      { w: 2, v: "{noun} in {obj}" },
      { w: 1, v: "{noun} No. {num}" }
    ],
    words: {
      noun: ["Nocturne", "Elegy", "\xC9tude", "Requiem", "Sonata", "Prelude", "Lament", "Canon", "Vespers", "Madrigal"],
      obj: ["Forgotten Letters", "Burnt Manuscripts", "Empty Lecture Halls", "a Dead Language", "October Rain", "Candlelight", "the Library Stairs", "Pressed Violets", "an Unfinished Thesis", "Ivy and Ash"],
      num: ["II", "III", "IV", "VII", "IX", "XIII"]
    }
  },
  bpm: [72, 96],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 9 },
    // A
    { w: 2, v: 2 },
    // D
    { w: 2, v: 4 },
    // E
    { w: 2, v: 7 },
    // G
    { w: 1, v: 11 }
    // B
  ],
  modes: [
    { w: 2, v: "harmonicMinor" },
    { w: 2, v: "naturalMinor" }
  ],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 2 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 }
      ]
    }
  ],
  progressions: [
    // i–iv–V7–i.
    {
      w: 2,
      v: [
        { degree: 0, beats: 4 },
        { degree: 3, beats: 4 },
        { degree: 4, beats: 4, quality: "dom7" },
        { degree: 0, beats: 4 }
      ]
    },
    // Lament: i–VII–VI–V7.
    {
      w: 2,
      v: [
        { degree: 0, beats: 4 },
        { degree: 6, beats: 4 },
        { degree: 5, beats: 4 },
        { degree: 4, beats: 4, quality: "dom7" }
      ]
    },
    // Circle-of-fifths sequence: i–iv–VII–III–VI–ii°–V7–i.
    {
      w: 1,
      v: [
        { degree: 0, beats: 2 },
        { degree: 3, beats: 2 },
        { degree: 6, beats: 2 },
        { degree: 2, beats: 2 },
        { degree: 5, beats: 2 },
        { degree: 1, beats: 2 },
        { degree: 4, beats: 2, quality: "dom7" },
        { degree: 0, beats: 2 }
      ]
    }
  ],
  melody: {
    register: [64, 86],
    // violin
    density: 0.45,
    leapProb: 0.22,
    restProb: 0.18,
    syncopation: 0.15
    // classical phrasing, mostly on the grid
  },
  bass: { style: "sustain", register: [36, 55] },
  // bowed cello
  comping: { register: [52, 72], style: "alberti" },
  drums: {
    patterns: [{ w: 1, v: NO_DRUMS }],
    fillEvery: 8
  },
  instruments: {
    // no drums entry — chamber ensemble
    lead: { program: 40, name: "Violin" },
    bass: { program: 42, name: "Cello" },
    chords: { program: 6, name: "Harpsichord" }
  },
  arrange: {
    layers: {
      intro: ["chords", "bass"]
      // harpsichord and cello set the scene
    },
    sectionVelocity: { intro: 0.85 }
  },
  humanize: { timingTicks: 16, velocity: 0.2 }
};

// src/core/genres/nightcore.ts
var EURO_FLOOR = {
  name: "euro-floor",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
  // the offbeat pump
};
var EURO_DRIVE = {
  name: "euro-drive",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.6, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0, 1, 0, 0, 0.5],
  hatClosed: [0.8, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var NIGHTCORE = {
  id: "nightcore",
  name: "Nightcore",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun} \u2665" },
      { w: 2, v: "{adj} {noun}!!" },
      { w: 1, v: "{noun} {noun2} \u2606" },
      { w: 1, v: "(sped up) {adj} {noun}" }
    ],
    words: {
      adj: ["sweetheart", "sugar", "neon", "moonlit", "bubblegum", "starry", "midnight", "glitter", "cherry", "dizzy"],
      noun: ["overdrive", "rush", "heartbeat", "confession", "parade", "daydream", "spin", "sparkle", "crush", "melody"]
    }
  },
  bpm: [160, 180],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 9 },
    // A
    { w: 2, v: 4 },
    // E
    { w: 2, v: 11 },
    // B
    { w: 2, v: 2 },
    // D
    { w: 1, v: 6 }
    // F#
  ],
  modes: [
    { w: 2, v: "major" },
    { w: 2, v: "naturalMinor" }
    // uplifting minor — half the canon
  ],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "B", bars: 8 },
        { name: "A", bars: 8 }
      ]
    }
  ],
  progressions: [
    // I–V–vi–IV and the eurodance staples.
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 4, beats: 4 }, { degree: 5, beats: 4 }, { degree: 3, beats: 4 }] },
    { w: 2, v: [{ degree: 5, beats: 4 }, { degree: 3, beats: 4 }, { degree: 0, beats: 4 }, { degree: 4, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }, { degree: 4, beats: 4 }] }
  ],
  melody: {
    register: [76, 96],
    // way up — the pitched-up voice
    density: 0.65,
    leapProb: 0.25,
    restProb: 0.08,
    syncopation: 0.5
  },
  bass: { style: "synth8", register: [33, 50] },
  arp: { register: [64, 88], rate: 4 },
  // 16th trance arp
  drums: {
    patterns: [
      { w: 2, v: EURO_FLOOR },
      { w: 1, v: EURO_DRIVE }
    ],
    fillEvery: 8
  },
  instruments: {
    lead: { program: 90, name: "Supersaw Lead" },
    // GM Pad 3 (polysynth)
    arp: { program: 81, name: "Trance Arp" },
    bass: { program: 38, name: "Euro Bass" },
    drums: { program: 0, name: "Euro Kit" }
  },
  arrange: {
    layers: {
      intro: ["arp", "bass", "drums"]
    },
    sectionVelocity: { intro: 0.85 }
  },
  humanize: { timingTicks: 3, velocity: 0.07 },
  filterAutomation: {
    // Trance riser: the arp sweeps open across the intro into the first drop.
    target: "arp",
    open: 5200,
    sections: {
      intro: { move: "sweep", fromHz: 500 }
    }
  }
};

// src/core/genres/phonk.ts
var KICK = 36;
var SNARE = 38;
var HAT = 42;
function placeLow2(pc, lo, hi) {
  for (let p = lo; p <= hi; p++) {
    if (mod12(p) === pc) return p;
  }
  return lo;
}
var genPhonkDrums = (ctx) => {
  const inst = ctx.cfg.instruments.drums;
  if (!inst) return null;
  const rng = ctx.rng("drums");
  const step = ctx.barTicks / 16;
  const t32 = step / 2;
  const kickTicks = [];
  const notes = [];
  for (const section of ctx.sections) {
    const sStart = section.startBar * ctx.barTicks;
    for (let bar = 0; bar < section.bars; bar++) {
      const b0 = sStart + bar * ctx.barTicks;
      if (section.name === "intro" || section.name === "outro") continue;
      if (section.name === "buildup") {
        const div = [2, 4, 8, 16][Math.min(bar, 3)];
        const isLastBar = bar === section.bars - 1;
        for (let i = 0; i < div; i++) {
          const st = 16 / div * i;
          if (isLastBar && st >= 12) break;
          notes.push({
            pitch: SNARE,
            start: b0 + st * step,
            dur: 40,
            vel: Math.min(120, 64 + Math.round((bar * 16 + st) * 0.85))
          });
        }
        continue;
      }
      const isBridge = section.name === "bridge";
      const kicks = [0];
      if (!isBridge) {
        if (rng.chance(0.6)) kicks.push(rng.pick([7, 10]));
        if (rng.chance(0.35)) kicks.push(14);
      } else if (rng.chance(0.4)) {
        kicks.push(10);
      }
      for (const k of [...new Set(kicks)].sort((a, b) => a - b)) {
        const tick = b0 + k * step;
        notes.push({ pitch: KICK, start: tick, dur: 100, vel: 118 });
        kickTicks.push(tick);
      }
      notes.push({ pitch: SNARE, start: b0 + 8 * step, dur: 60, vel: 112 });
      for (let st = 0; st < 16; st += 2) {
        if (isBridge && rng.chance(0.35)) continue;
        notes.push({ pitch: HAT, start: b0 + st * step, dur: 30, vel: st % 4 === 0 ? 62 : 48 });
      }
      if (!isBridge && rng.chance(0.27)) {
        const st = rng.pick([3, 5, 11, 13]);
        if (rng.chance(0.5)) {
          for (let i = 0; i < 2; i++) {
            notes.push({ pitch: HAT, start: b0 + st * step + i * t32, dur: 25, vel: 55 + i * 12 });
          }
        } else {
          const t3 = step * 2 / 3;
          for (let i = 0; i < 3; i++) {
            notes.push({ pitch: HAT, start: b0 + st * step + Math.round(i * t3), dur: 25, vel: 50 + i * 12 });
          }
        }
      }
    }
  }
  ctx.shared.set("phonk.kicks", kickTicks);
  return { name: inst.name, channel: DRUM_CHANNEL, program: inst.program, role: "drums", notes };
};
var genPhonkBass = (ctx) => {
  const inst = ctx.cfg.instruments.bass;
  if (!inst) return null;
  const rng = ctx.rng("bass");
  const kicks = ctx.shared.get("phonk.kicks") ?? [];
  const [lo, hi] = ctx.cfg.bass.register;
  const second = SCALE_INTERVALS[ctx.key.mode][1] ?? 1;
  const notes = [];
  for (let i = 0; i < kicks.length; i++) {
    const tick = kicks[i];
    const next = kicks[i + 1];
    const root = ctx.chordAt(tick).root;
    let pitch = placeLow2(root, lo, hi);
    const barIdx = Math.floor(tick / ctx.barTicks);
    const lastOfSquare = barIdx % 8 === 7 && (next === void 0 || Math.floor(next / ctx.barTicks) !== barIdx);
    if (lastOfSquare && pitch + 12 <= hi + 12) {
      pitch += 12;
    } else if (tick % ctx.barTicks !== 0 && rng.chance(0.3)) {
      pitch = placeLow2(mod12(root + (rng.chance(0.5) ? 7 : second)), lo, hi);
    }
    const dur = next !== void 0 ? Math.min(next - tick - 5, ctx.barTicks) : ctx.beatTicks * 2;
    notes.push({ pitch, start: tick, dur: Math.max(120, dur), vel: 115 });
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "bass", notes };
};
var genPhonkLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const step = ctx.barTicks / 16;
  const [lo, hi] = ctx.cfg.melody.register;
  const tonicPitch = placeLow2(ctx.key.tonic, lo + 4, hi);
  const second = SCALE_INTERVALS[ctx.key.mode][1] ?? 1;
  const OFFSETS = [
    { w: 4, v: 0 },
    { w: 3, v: second },
    { w: 2, v: 6 },
    // tritone
    { w: 2, v: 3 },
    { w: 1, v: 7 },
    { w: 1, v: 10 }
  ];
  const riff = [];
  for (let s = 0; s < 32; s++) {
    const inBar = s % 16;
    let p;
    if (inBar === 2 || inBar === 6 || inBar === 10 || inBar === 14) p = 0.85;
    else if (inBar === 0) p = s === 0 ? 0.9 : 0.5;
    else if (inBar % 4 === 0) p = 0.35;
    else p = 0.15;
    if (!rng.chance(p)) continue;
    riff.push({
      step: s,
      offset: rng.weighted(OFFSETS),
      oct: rng.chance(0.18) ? rng.chance(0.5) ? 12 : -12 : 0
    });
  }
  const clamp = (p) => {
    while (p > hi) p -= 12;
    while (p < lo) p += 12;
    return p;
  };
  const notes = [];
  for (const section of ctx.sections) {
    const sStart = section.startBar * ctx.barTicks;
    for (let bar = 0; bar < section.bars; bar++) {
      const b0 = sStart + bar * ctx.barTicks;
      const globalBar = section.startBar + bar;
      const buildupCut = section.name === "buildup" && bar === section.bars - 1;
      const roll = !buildupCut && globalBar % 2 === 1;
      for (const ev of riff) {
        if (Math.floor(ev.step / 16) !== globalBar % 2) continue;
        const inBar = ev.step % 16;
        if (buildupCut && inBar >= 12) continue;
        if (roll && inBar >= 12) continue;
        notes.push({
          pitch: clamp(tonicPitch + ev.offset + ev.oct),
          start: b0 + inBar * step,
          dur: Math.floor(step * 0.8),
          // staccato: decay ~100–200ms, no tail
          vel: rng.int(96, 110)
        });
      }
      if (roll) {
        for (let i = 0; i < 8; i++) {
          notes.push({
            pitch: tonicPitch,
            start: b0 + 12 * step + Math.floor(i * (step / 2)),
            dur: Math.floor(step / 2),
            vel: 60 + i * 7
            // crescendo
          });
        }
      }
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
var PHONK = {
  id: "phonk",
  name: "Drift Phonk",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun}" },
      { w: 2, v: "{noun} \xD7 {noun2}" },
      { w: 1, v: "DEVIL IN THE {noun}" },
      { w: 1, v: "{adj} {noun} '94" }
    ],
    words: {
      adj: ["MEMPHIS", "SMOKED", "CURSED", "DRIFTIN", "COLD", "SLOWED", "HAUNTED", "BLACKED", "GRAVEYARD", "MIDNIGHT"],
      noun: ["TRUNK", "808", "HEARSE", "INTERIOR", "PLAYA", "CYPHER", "SLAB", "TINTS", "SWITCHBLADE", "PHONK"]
    }
  },
  bpm: [120, 135],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 1 },
    // C#
    { w: 2, v: 2 },
    // D
    { w: 2, v: 9 },
    // A
    { w: 2, v: 5 },
    // F
    { w: 1, v: 4 }
    // E
  ],
  modes: [
    { w: 2, v: "phrygian" },
    // the minor second is the darkness
    { w: 2, v: "naturalMinor" }
  ],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "buildup", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "bridge", bars: 8 },
        { name: "drop", bars: 8 },
        { name: "outro", bars: 2 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "buildup", bars: 4 },
        { name: "drop", bars: 16 },
        { name: "bridge", bars: 8 },
        { name: "drop", bars: 8 },
        { name: "outro", bars: 4 }
      ]
    }
  ],
  progressions: [
    // Monolithic vamps — the riff and the 808 carry the harmony.
    { w: 2, v: [{ degree: 0, beats: 16 }] },
    { w: 1, v: [{ degree: 0, beats: 8 }, { degree: 1, beats: 8 }] },
    // i–bII
    { w: 1, v: [{ degree: 0, beats: 12 }, { degree: 5, beats: 4 }] }
  ],
  melody: {
    register: [58, 76],
    density: 0.6,
    // unused by the custom lead, kept for the type
    leapProb: 0.18,
    restProb: 0.1,
    syncopation: 0.6
  },
  bass: { style: "s808", register: [26, 40] },
  drums: {
    patterns: [],
    // custom generator — patterns unused
    fillEvery: 8
  },
  instruments: {
    lead: { program: 113, name: "Phonk Cowbell" },
    bass: { program: 39, name: "808 Glide" },
    drums: { program: 0, name: "Memphis Kit" }
  },
  arrange: {
    layers: {
      intro: ["lead"],
      // underwater cowbell alone (LPF closed — audio layer)
      buildup: ["lead", "drums"],
      bridge: ["lead", "drums"],
      // bass vanishes — the release
      outro: ["lead"]
      // bare riff → loops into the filtered intro
    },
    sectionVelocity: { intro: 0.8, buildup: 0.9, bridge: 0.92, outro: 0.75 }
  },
  humanize: { timingTicks: 2, velocity: 0.05 },
  // sequencer-tight
  filterAutomation: {
    target: "lead",
    open: 8800,
    sections: {
      intro: { move: "closed", hz: 380 },
      // underwater
      outro: { move: "closed", hz: 380 },
      buildup: { move: "sweep", fromHz: 380 }
      // opens into the drop
    }
  },
  hooks: {
    drums: genPhonkDrums,
    bass: genPhonkBass,
    melody: genPhonkLead
  }
};

// src/core/genres/tune.ts
var EIGHTH = PPQ / 2;
var SLOTS_PER_BAR = 8;
var RHYTHMS = [
  { w: 3, v: [0, 1, 2, 3, 4, 5, 6, 7] },
  { w: 2, v: [0, 1, 2, 4, 5, 6] },
  { w: 2, v: [0, 2, 3, 4, 6, 7] },
  { w: 1, v: [0, 2, 4, 6] }
];
function rootAbove(pc, lo) {
  for (let p = lo; p < lo + 12; p++) {
    if (mod12(p) === pc) return p;
  }
  return lo;
}
var genTuneLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const [lo, hi] = ctx.cfg.melody.register;
  const onsets = rng.weighted(RHYTHMS);
  const n = onsets.length;
  const peakPos = rng.int(2, Math.min(4, n - 2));
  const call = [];
  let v = 0;
  for (let i = 0; i < n; i++) {
    call.push(v);
    v += i < peakPos ? 1 : -1;
    if (v < 0) v = 0;
  }
  const response = [...call];
  response[n - 1] = 0;
  const notes = [];
  for (let bar = 0; bar < ctx.totalBars; bar++) {
    const barStart = bar * ctx.barTicks;
    const ladder = bar % 2 === 0 ? call : response;
    const chord = ctx.chordAt(barStart);
    const third = mod12(12 + (chord.pitchClasses[1] ?? chord.root) - chord.root);
    const fifth = mod12(12 + (chord.pitchClasses[2] ?? chord.root) - chord.root);
    const offsets = [0, third, fifth, 12, 12 + third, 12 + fifth];
    const base = rootAbove(chord.root, lo);
    for (let i = 0; i < n; i++) {
      const step = onsets[i];
      const nextStep = onsets[i + 1] ?? SLOTS_PER_BAR;
      let pitch = base + offsets[Math.min(ladder[i], offsets.length - 1)];
      while (pitch > hi) pitch -= 12;
      notes.push({
        pitch,
        start: barStart + step * EIGHTH,
        dur: Math.max(30, (nextStep - step) * EIGHTH - 25),
        // staccato, mizhgan's 0.9-step blips
        vel: step === 0 ? 104 : step % 2 === 0 ? 98 : 84
      });
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
var OFFBEAT_HATS = {
  name: "offbeat-hats",
  kick: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var KICK_AND_HATS = {
  name: "kick-and-hats",
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var genTuneDrums = (ctx) => {
  const inst = ctx.cfg.instruments.drums;
  if (!inst) return null;
  const rng = ctx.rng("drums");
  const pattern = rng.weighted(ctx.cfg.drums.patterns);
  const stepTicks = ctx.barTicks / 16;
  const notes = [];
  for (let bar = 0; bar < ctx.totalBars; bar++) {
    const barStart = bar * ctx.barTicks;
    for (let s = 0; s < 16; s++) {
      if ((pattern.kick[s] ?? 0) > 0) {
        notes.push({ pitch: GM_DRUMS.kick, start: barStart + s * stepTicks, dur: 60, vel: 102 });
      }
      if ((pattern.hatClosed[s] ?? 0) > 0) {
        notes.push({ pitch: GM_DRUMS.hatClosed, start: barStart + s * stepTicks, dur: 30, vel: 46 });
      }
    }
  }
  return { name: inst.name, channel: DRUM_CHANNEL, program: inst.program, role: "drums", notes };
};
var TUNE = {
  id: "tune",
  hidden: true,
  // internal — out of listGenres() and docs by user request
  name: "Tune",
  naming: {
    patterns: [
      { w: 2, v: "Little {noun} No. {num}" },
      { w: 1, v: "{noun} No. {num}" },
      { w: 1, v: "Tiny {noun}" }
    ],
    words: {
      noun: ["Loop", "Tune", "Jingle", "Melody", "Ditty"],
      num: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
    }
  },
  bpm: [138, 152],
  timeSig: [4, 4],
  keys: [
    { w: 4, v: 9 },
    // A — the mizhgan key
    { w: 2, v: 4 },
    // E
    { w: 1, v: 2 },
    // D
    { w: 1, v: 7 }
    // G
  ],
  modes: [{ w: 1, v: "naturalMinor" }],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "A", bars: 8 },
        { name: "A", bars: 8 },
        { name: "A", bars: 8 }
      ]
    }
  ],
  progressions: [
    // One chord per bar, looping — degrees 0-based in minor.
    { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–VI–III–v (Am–F–C–Em: the mizhgan bass line)
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
    // i–VI–III–VII
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] }
    // i–VII–VI–v
  ],
  melody: {
    register: [62, 86],
    // D4–D6, mizhgan's F4–A5 sits in the middle
    density: 0.9,
    // nominal — the hook uses its own rhythm templates
    leapProb: 0.2,
    restProb: 0,
    syncopation: 0
  },
  bass: {
    style: "sustain",
    // long roots on the chord changes, nothing else
    register: [33, 50]
    // A1–D3
  },
  drums: {
    patterns: [
      { w: 1, v: OFFBEAT_HATS },
      { w: 1, v: KICK_AND_HATS }
    ],
    fillEvery: 8
    // unused — the drums hook plays the pattern verbatim, no fills
  },
  instruments: {
    lead: { program: 80, name: "Square Lead" },
    bass: { program: 38, name: "Synth Bass" },
    drums: { program: 0, name: "Hats" }
  },
  arrange: {
    layers: {}
    // everyone plays all the time — it's a loop, not a song
  },
  humanize: { timingTicks: 0, velocity: 0.02 },
  // machine grid, like the original setInterval
  hooks: {
    melody: genTuneLead,
    drums: genTuneDrums
  }
};

// src/core/genres/musicbox.ts
var EIGHTH2 = PPQ / 2;
var PHRASE_BARS = 4;
var RING = PPQ / 2;
var BAR_RHYTHMS = [
  { w: 3, v: [0, 2, 4] },
  // plain quarters
  { w: 2, v: [0, 1, 2, 4] },
  { w: 2, v: [0, 2, 3, 4] },
  { w: 2, v: [0, 3, 4] },
  // dotted lilt
  { w: 1, v: [0, 4] },
  { w: 1, v: [0, 1, 2, 3, 4] }
];
var CADENCE_RHYTHMS = [
  { w: 2, v: [0] },
  { w: 1, v: [0, 2] }
];
function buildPhrase(rng, ctx, chords, state) {
  const [lo, hi] = ctx.cfg.melody.register;
  const tonic = ctx.key.tonic;
  const mode = ctx.key.mode;
  const mainRhythm = rng.weighted(BAR_RHYTHMS);
  const cadenceRhythm = rng.weighted(CADENCE_RHYTHMS);
  const notes = [];
  for (let bar = 0; bar < PHRASE_BARS; bar++) {
    const barStart = bar * ctx.barTicks;
    const chord = chords[bar];
    const isCadence = bar === PHRASE_BARS - 1;
    const onsets = isCadence ? cadenceRhythm : mainRhythm;
    const drift = bar < PHRASE_BARS / 2 ? 1 : -1;
    for (let i = 0; i < onsets.length; i++) {
      const slot = onsets[i];
      const tick = barStart + slot * EIGHTH2;
      const nextTick = i + 1 < onsets.length ? barStart + onsets[i + 1] * EIGHTH2 : barStart + ctx.barTicks;
      if (slot === 0) {
        state.pitch = clampRegister(nearestChordTone(state.pitch, chord), lo, hi);
      } else if (rng.chance(0.12)) {
        const target = clampRegister(
          nearestChordTone(state.pitch + drift * rng.int(3, 8), chord),
          lo,
          hi
        );
        state.pitch = Math.abs(target - state.pitch) <= 9 ? target : state.pitch;
      } else {
        const dir = rng.chance(0.7) ? drift : -drift;
        state.pitch = clampRegister(nextScalePitch(state.pitch, dir, tonic, mode), lo, hi);
      }
      if (slot > 0 && rng.chance(0.08)) {
        notes.push({
          pitch: clampRegister(nextScalePitch(state.pitch, 1, tonic, mode), lo, hi),
          start: tick - 60,
          dur: 55,
          vel: 58
        });
      }
      notes.push({
        pitch: state.pitch,
        start: tick,
        dur: nextTick - tick + RING,
        // no damper — ring into the next note
        vel: slot === 0 ? 76 : 70
      });
    }
  }
  return notes;
}
var genMusicboxLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const [lo, hi] = ctx.cfg.melody.register;
  const phraseTicks = PHRASE_BARS * ctx.barTicks;
  const cache = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    const sectionStart = section.startBar * ctx.barTicks;
    const sectionEnd = sectionStart + section.bars * ctx.barTicks;
    let phrases = cache.get(sectionKey(section));
    if (!phrases) {
      const chords = Array.from(
        { length: PHRASE_BARS },
        (_, bar) => ctx.chordAt(sectionStart + bar * ctx.barTicks)
      );
      const state = { pitch: Math.round((lo + hi) / 2) };
      phrases = { a: buildPhrase(rng, ctx, chords, state), b: buildPhrase(rng, ctx, chords, state) };
      cache.set(sectionKey(section), phrases);
    }
    const count = Math.ceil(section.bars / PHRASE_BARS);
    const sectionNotes = [];
    for (let u = 0; u < count; u++) {
      const phrase = u % 4 === 2 ? phrases.b : phrases.a;
      const offset = sectionStart + u * phraseTicks;
      sectionNotes.push(...phrase.map((n) => ({ ...n, start: n.start + offset })));
    }
    const last = sectionNotes[sectionNotes.length - 1];
    if (last) {
      let p = last.pitch;
      for (let d = 0; d < 12; d++) {
        if (mod12(p - d) === ctx.key.tonic) {
          p = p - d;
          break;
        }
        if (mod12(p + d) === ctx.key.tonic) {
          p = p + d;
          break;
        }
      }
      last.pitch = clampRegister(p, lo, hi);
      last.dur = Math.max(last.dur, sectionEnd - last.start - 10);
    }
    const clipped = sectionNotes.filter((n) => n.start < sectionEnd && n.start >= sectionStart);
    for (const n of clipped) n.dur = Math.min(n.dur, sectionEnd - n.start);
    notes.push(...clipped);
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
function rootAbove2(pc, lo) {
  for (let p = lo; p < lo + 12; p++) {
    if (mod12(p) === pc) return p;
  }
  return lo;
}
var genMusicboxAccomp = (ctx) => {
  const inst = ctx.cfg.instruments.chords;
  if (!inst) return null;
  const rng = ctx.rng("comping");
  const cfg = ctx.cfg.comping;
  if (!cfg) return null;
  const [lo, hi] = cfg.register;
  const ascending = rng.chance(0.4);
  const notes = [];
  for (let bar = 0; bar < ctx.totalBars; bar++) {
    const barStart = bar * ctx.barTicks;
    const chord = ctx.chordAt(barStart);
    const root = rootAbove2(chord.root, lo);
    const third = root + mod12(12 + (chord.pitchClasses[1] ?? chord.root) - chord.root);
    const fifth = root + mod12(12 + (chord.pitchClasses[2] ?? chord.root) - chord.root);
    const beats = ascending ? [root, third, fifth] : [root, fifth, third];
    for (let beat = 0; beat < 3; beat++) {
      let pitch = beats[beat];
      while (pitch > hi) pitch -= 12;
      notes.push({
        pitch,
        start: barStart + beat * ctx.beatTicks,
        dur: ctx.barTicks - beat * ctx.beatTicks + RING,
        // ring to the bar line and past it
        vel: beat === 0 ? 58 : 52
      });
    }
  }
  const total = ctx.totalBars * ctx.barTicks;
  for (const n of notes) n.dur = Math.min(n.dur, total - n.start);
  return { name: inst.name, channel: 0, program: inst.program, role: "chords", notes };
};
var MUSICBOX = {
  id: "musicbox",
  name: "Music Box",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun}" },
      { w: 1, v: "{noun} for a {adj} {obj}" },
      { w: 1, v: "Waltz for a {adj} {obj}" }
    ],
    words: {
      adj: ["Clockwork", "Paper", "Porcelain", "Winter", "Tarnished", "Moonlight", "Attic", "Snowglobe", "Faded", "Velvet"],
      noun: ["Lullaby", "Waltz", "Carousel", "Ballerina", "Berceuse", "Minuet", "Reverie", "Keepsake", "Locket", "Dream"],
      obj: ["Moon", "Ballerina", "Music Box", "Snow Queen", "Sleeping Fox", "Tin Soldier", "Lost Button", "Winter Garden"]
    }
  },
  bpm: [66, 92],
  timeSig: [3, 4],
  keys: [
    { w: 2, v: 9 },
    // A
    { w: 2, v: 0 },
    // C
    { w: 1, v: 4 },
    // E
    { w: 1, v: 2 },
    // D
    { w: 1, v: 7 },
    // G
    { w: 1, v: 5 }
    // F
  ],
  modes: [
    { w: 2, v: "major" },
    // sweet lullaby
    { w: 2, v: "naturalMinor" },
    // nostalgic / eerie
    { w: 1, v: "harmonicMinor" }
  ],
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "A", bars: 16 },
        { name: "A", bars: 16 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "A", bars: 16 },
        { name: "B", bars: 16 },
        { name: "A", bars: 16 }
      ]
    }
  ],
  progressions: [
    // One chord per 3/4 bar, 4-bar cycles (phrase-aligned).
    { w: 2, v: [{ degree: 0, beats: 3 }, { degree: 4, beats: 3 }, { degree: 5, beats: 3 }, { degree: 3, beats: 3 }] },
    { w: 2, v: [{ degree: 0, beats: 3 }, { degree: 5, beats: 3 }, { degree: 3, beats: 3 }, { degree: 4, beats: 3 }] },
    { w: 2, v: [{ degree: 0, beats: 3 }, { degree: 3, beats: 3 }, { degree: 4, beats: 3 }, { degree: 0, beats: 3 }] },
    { w: 1, v: [{ degree: 0, beats: 3 }, { degree: 4, beats: 3 }, { degree: 0, beats: 3 }, { degree: 4, beats: 3 }] }
  ],
  distinctProgressions: true,
  melody: {
    register: [72, 96],
    // C5–C7: the high tines
    density: 0.6,
    // nominal — the hook uses its own bar rhythms
    leapProb: 0.12,
    restProb: 0,
    syncopation: 0
  },
  bass: {
    style: "sustain",
    // unused — no bass instrument; the comb has no bass
    register: [48, 60]
  },
  comping: {
    register: [55, 76]
    // G3–E5: the low tines
  },
  drums: {
    patterns: [],
    // no drums in a music box
    fillEvery: 16
  },
  instruments: {
    lead: { program: 10, name: "Music Box" },
    chords: { program: 10, name: "Music Box Low" }
  },
  arrange: {
    layers: {}
  },
  humanize: { timingTicks: 3, velocity: 0.04 },
  // clockwork with a faint spring flutter
  hooks: {
    melody: genMusicboxLead,
    comping: genMusicboxAccomp
  }
};

// src/core/genres/eurobeat.ts
var EB_FLOOR = {
  name: "eb-floor",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
  // offbeat pump
};
var EB_DRIVE = {
  name: "eb-drive",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.6, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0, 1, 0, 0, 0.5],
  hatClosed: [0.8, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  perc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0]
  // clap pickup into the next bar
};
var EB_PUMP = {
  name: "eb-pump",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  perc: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
};
var EB_RUSH = {
  name: "eb-rush",
  kick: [1, 0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0, 0, 1, 0, 0.6, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0.3, 0, 1, 0, 0, 0.5],
  hatClosed: [0.8, 0.5, 0.6, 0.5, 0.8, 0.5, 0.6, 0.5, 0.8, 0.5, 0.6, 0.5, 0.8, 0.5, 0.6, 0.5],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var EUROBEAT = {
  id: "eurobeat",
  name: "Eurobeat",
  naming: {
    patterns: [
      { w: 3, v: "{verb} IN THE {noun}" },
      { w: 3, v: "{adj} {noun}" },
      { w: 2, v: "{noun} {noun2}" },
      { w: 1, v: "{noun} {noun2} {noun2}" },
      // GAS GAS GAS energy
      { w: 1, v: "MAX {noun}" }
    ],
    words: {
      verb: ["RUNNING", "BURNING", "RACING", "DANCING", "CRASHING", "DRIFTING", "FLYING"],
      adj: ["CRAZY", "MIDNIGHT", "TURBO", "WILD", "ETERNAL", "SUPERSONIC", "DANGEROUS", "GOLDEN"],
      noun: ["NIGHT", "FIRE", "POWER", "HIGHWAY", "HEARTBEAT", "ENGINE", "THUNDER", "SPEED", "LOVE", "DESIRE"]
    }
  },
  bpm: [150, 162],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 9 },
    // A — the eurobeat home key
    { w: 2, v: 4 },
    // E
    { w: 2, v: 2 },
    // D
    { w: 1, v: 11 },
    // B
    { w: 1, v: 7 }
    // G
  ],
  modes: [
    { w: 3, v: "naturalMinor" },
    { w: 1, v: "harmonicMinor" },
    // raised-leading-tone drama
    { w: 1, v: "major" }
  ],
  swing: [0, 0],
  structures: [
    // Same rhythm-game arc as outrun: quiet valley (break) between two peaks.
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      // One extended 16-bar euphoria drop (single drop — loops break→intro).
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 16 },
        { name: "break", bars: 8 }
      ]
    },
    {
      // Long breather between two drops.
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 12 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    }
  ],
  progressions: [
    // The eurobeat staples, minor-side.
    { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }, { degree: 0, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] },
    // More euro movement (incl. major-side lift for the major mode).
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–VI–iv–V
    { w: 1, v: [{ degree: 5, beats: 4 }, { degree: 3, beats: 4 }, { degree: 0, beats: 4 }, { degree: 4, beats: 4 }] },
    // VI–iv–i–V
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 4, beats: 4 }, { degree: 5, beats: 4 }, { degree: 3, beats: 4 }] },
    // I–V–vi–IV
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }] }
    // i–VII–iv–V
  ],
  distinctProgressions: true,
  melody: {
    register: [69, 91],
    // screaming saw riff on top
    density: 0.75,
    leapProb: 0.3,
    restProb: 0.06,
    syncopation: 0.45
  },
  bass: {
    style: "octave8",
    // root/octave see-saw — THE eurobeat engine
    styles: [
      { w: 3, v: "octave8" },
      { w: 1, v: "synth8" },
      // driving root-pump variant
      { w: 1, v: "syncopated16" }
      // sequenced 3-3-2 push
    ],
    register: [33, 47]
  },
  comping: { register: [57, 76], style: "stabs" },
  // synth-brass hits
  // Reverted to the known-good arp (updown/octaves) — the added up/down cycles
  // made it wander through the lead register = "каша/каконофония".
  arp: { register: [64, 86], rate: 4, patterns: [{ w: 2, v: "updown" }, { w: 1, v: "octaves" }] },
  drums: {
    patterns: [
      { w: 3, v: EB_FLOOR },
      { w: 2, v: EB_DRIVE },
      { w: 2, v: EB_PUMP },
      { w: 1, v: EB_RUSH }
    ],
    fillEvery: 8,
    fillStyle: "mixed"
  },
  instruments: {
    lead: { program: 81, name: "Saw Lead" },
    // GM Lead 2 (sawtooth)
    chords: { program: 62, name: "Synth Brass" },
    arp: { program: 81, name: "Euro Arp" },
    bass: { program: 38, name: "Octave Bass" },
    // GM Synth Bass 1
    drums: { program: 0, name: "Euro Kit" }
  },
  arrange: {
    // Energy per section = terrain height, mirroring outrun.
    layers: {
      intro: ["arp", "bass"],
      build: ["arp", "bass", "drums"],
      drop: "all",
      break: ["chords", "arp", "bass"]
    },
    sectionVelocity: { intro: 0.8, build: 0.92, break: 0.82, drop: 1.05 }
  },
  // Zero timing jitter: note.start ticks ARE the beatmap (rhythm-game contract).
  humanize: { timingTicks: 0, velocity: 0.06 },
  filterAutomation: {
    // Master lowpass: muffled valley in the break, sweep up through the build.
    target: "master",
    open: 9e3,
    sections: {
      intro: { move: "sweep", fromHz: 600 },
      build: { move: "sweep", fromHz: 900 },
      break: { move: "closed", hz: 1400 }
    }
  }
};

// src/core/genres/outrun.ts
var OR_DRIVE = {
  name: "or-drive",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  // the big gated hit
  hatClosed: [0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  perc: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
  // clap glued to the snare
};
var OR_PULSE = {
  name: "or-pulse",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.5],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0],
  hatOpen: [0, 0, 0.8, 0, 0, 0, 0.8, 0, 0, 0, 0.8, 0, 0, 0, 0.8, 0]
};
var OR_ELECTRO = {
  name: "or-electro",
  kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
  perc: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]
};
var OR_RUSH = {
  name: "or-rush",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0, 1, 0, 0, 0.4],
  hatClosed: [0.8, 0.5, 0.6, 0.5, 0.8, 0.5, 0.6, 0.5, 0.8, 0.5, 0.6, 0.5, 0.8, 0.5, 0.6, 0.5],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var OUTRUN = {
  id: "outrun",
  name: "Outrun",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun}" },
      { w: 2, v: "NEON {noun}" },
      { w: 2, v: "{noun} {noun2}" },
      { w: 1, v: "{adj} {noun} 2087" }
    ],
    words: {
      adj: ["MIDNIGHT", "CHROME", "STELLAR", "LASER", "CRYSTAL", "INFINITE", "BINARY", "PHANTOM", "ELECTRIC"],
      noun: ["HORIZON", "VELOCITY", "STARFIELD", "HIGHWAY", "ORBIT", "ECLIPSE", "VECTOR", "PULSAR", "GRID", "NEBULA"]
    }
  },
  bpm: [118, 132],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 9 },
    // A
    { w: 2, v: 2 },
    // D
    { w: 2, v: 4 },
    // E
    { w: 1, v: 6 }
    // F#
  ],
  modes: [
    { w: 3, v: "naturalMinor" },
    { w: 1, v: "dorian" }
    // the hopeful night-drive tint
  ],
  swing: [0, 0],
  structures: [
    // The dynamics arc IS the level design: quiet valley sections between drops.
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      // One extended 16-bar cruise drop (single drop — loops break→intro).
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 16 },
        { name: "break", bars: 8 }
      ]
    },
    {
      // Long neon valley between two drops.
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 12 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    }
  ],
  progressions: [
    // Minor spacesynth loops, one chord per bar, last chord pulls home.
    { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 2, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] },
    { w: 1, v: [{ degree: 5, beats: 4 }, { degree: 6, beats: 4 }, { degree: 0, beats: 4 }, { degree: 0, beats: 4 }] },
    // More neon movement.
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–VI–VII–v
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 4, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }] },
    // i–v–VI–III
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–VII–iv–v
    { w: 1, v: [{ degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 0, beats: 4 }, { degree: 6, beats: 4 }] }
    // VI–III–i–VII
  ],
  distinctProgressions: true,
  melody: {
    register: [64, 86],
    density: 0.55,
    // breathing room — collectable, not a note storm
    leapProb: 0.25,
    restProb: 0.12,
    syncopation: 0.4
  },
  bass: {
    style: "syncopated16",
    styles: [
      { w: 2, v: "syncopated16" },
      // sequenced spacesynth engine
      { w: 2, v: "octave8" },
      { w: 1, v: "synth8" }
      // driving root-pump with octave pops
    ],
    register: [31, 45]
  },
  comping: { register: [52, 72], style: "sustained" },
  // analog pad bed
  // Backing arp, not a second melody — lower register + just up/octaves so it
  // doesn't wander through the lead's range and clash ("каконофония").
  arp: { register: [52, 74], rate: 4, patterns: [{ w: 2, v: "up" }, { w: 1, v: "octaves" }] },
  drums: {
    patterns: [
      { w: 3, v: OR_DRIVE },
      { w: 2, v: OR_PULSE },
      { w: 2, v: OR_ELECTRO },
      { w: 1, v: OR_RUSH }
    ],
    fillEvery: 8,
    fillStyle: "toms"
    // the 80s tom cascade
  },
  instruments: {
    lead: { program: 81, name: "Saw Lead" },
    chords: { program: 90, name: "Space Pad" },
    // GM Pad 3 (polysynth)
    arp: { program: 99, name: "Crystal Arp" },
    // GM FX 4 (atmosphere)... crystal shimmer
    bass: { program: 38, name: "Seq Bass" },
    drums: { program: 0, name: "Linn Kit" }
  },
  arrange: {
    // Energy per section = terrain height: valley (break) between two peaks (drop).
    layers: {
      intro: ["chords", "arp"],
      build: ["chords", "arp", "bass", "drums"],
      drop: "all",
      break: ["chords", "arp", "bass"]
    },
    sectionVelocity: { intro: 0.8, build: 0.92, break: 0.82, drop: 1.05 }
  },
  // Zero timing jitter: note.start ticks ARE the beatmap. Velocity still breathes.
  humanize: { timingTicks: 0, velocity: 0.05 },
  filterAutomation: {
    // Master lowpass: muffled valley in the break, sweep up through the build.
    target: "master",
    open: 9e3,
    sections: {
      intro: { move: "sweep", fromHz: 600 },
      build: { move: "sweep", fromHz: 900 },
      break: { move: "closed", hz: 1400 }
    }
  }
};

// src/core/genres/grimerun.ts
var RUN_HALFTIME = {
  name: "run-halftime",
  kick: [1, 0, 0, 0, 0, 0, 0, 0.7, 0, 0, 0.6, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0.9, 0, 0.5, 0, 0.7, 0, 0.5, 0.4, 0.9, 0, 0.5, 0, 0.7, 0, 0.5, 0]
};
var RUN_BUSY = {
  name: "run-busy",
  kick: [1, 0, 0, 0.6, 0, 0, 1, 0, 0, 0, 0, 0.6, 0, 0.7, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.4],
  hatClosed: [0.9, 0.4, 0.5, 0.4, 0.7, 0.4, 0.5, 0.4, 0.9, 0.4, 0.5, 0.4, 0.7, 0.4, 0.5, 0.4],
  hatOpen: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0]
};
var RUN_SKIPPY = {
  name: "run-skippy",
  kick: [1, 0, 0, 0, 0, 0, 0.7, 0, 0, 0.6, 0, 0, 0.7, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.4, 0, 0, 0, 0],
  hatClosed: [0.8, 0, 0.6, 0.4, 0.8, 0, 0.6, 0, 0.8, 0.4, 0.6, 0, 0.8, 0, 0.6, 0.4],
  hatOpen: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]
};
var RUN_ROLLER = {
  name: "run-roller",
  kick: [1, 0, 0, 0, 0, 0, 0, 0.7, 1, 0, 0, 0.6, 0, 0, 0.6, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0.9, 0.6, 0.6, 0.6, 0.9, 0.6, 0.6, 0.6, 0.9, 0.6, 0.6, 0.6, 0.9, 0.6, 0.6, 0.6],
  hatOpen: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var RUN_STEPPER = {
  name: "run-stepper",
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hatClosed: [0.8, 0, 0, 0, 0.6, 0, 0, 0, 0.8, 0, 0, 0, 0.6, 0, 0.5, 0]
};
var GRIMERUN = {
  id: "grimerun",
  name: "Grime Run",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun}" },
      { w: 1, v: "{adj} {noun} (VIP)" },
      { w: 1, v: "140 {noun}" },
      { w: 1, v: "M25 {noun}" }
    ],
    words: {
      adj: ["Midnight", "Motorway", "Nitro", "Burnout", "Slipstream", "Hairpin", "Redline", "Backstreet", "Overtake", "Concrete"],
      noun: ["Riddim", "Drift", "Pressure", "Skid", "Heat", "Velocity", "Chase", "Tarmac", "Dubplate", "Wheel-Up"]
    }
  },
  bpm: [132, 148],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 1 },
    // C#
    { w: 2, v: 6 },
    // F#
    { w: 2, v: 9 },
    // A
    { w: 2, v: 2 }
    // D
  ],
  modes: [
    { w: 2, v: "naturalMinor" },
    { w: 1, v: "phrygian" }
  ],
  swing: [0, 0],
  structures: [
    // The shared rhythm-game arc: quiet valley (break) between two peaks.
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      // Long peak: one extended 16-bar drop (single drop — loops break→intro).
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 16 },
        { name: "break", bars: 8 }
      ]
    },
    {
      // Two short drops around a long valley.
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 12 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    }
  ],
  progressions: [
    // Dark grime vamps — two chords, menace over movement.
    { w: 3, v: [{ degree: 0, beats: 8 }, { degree: 5, beats: 8 }] },
    { w: 2, v: [{ degree: 0, beats: 8 }, { degree: 3, beats: 8 }] },
    { w: 2, v: [{ degree: 0, beats: 8 }, { degree: 1, beats: 8 }] },
    // phrygian bII menace
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 1, beats: 4 }] },
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 0, beats: 4 }, { degree: 5, beats: 4 }] },
    // More movement — four-chord descents and minor turns.
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }] },
    // i–VII–VI–VII
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }] },
    // i–VI–VII–VI
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–iv–v–v
    { w: 1, v: [{ degree: 0, beats: 8 }, { degree: 6, beats: 8 }] }
    // i–VII drone
  ],
  distinctProgressions: true,
  melody: {
    register: [60, 76],
    // the cowbell octave
    density: 0.5,
    leapProb: 0.18,
    restProb: 0.22,
    syncopation: 0.6
  },
  bass: { style: "s808", register: [26, 41] },
  comping: { register: [48, 65] },
  drums: {
    patterns: [
      { w: 3, v: RUN_HALFTIME },
      { w: 2, v: RUN_BUSY },
      { w: 2, v: RUN_SKIPPY },
      { w: 2, v: RUN_ROLLER },
      { w: 1, v: RUN_STEPPER }
    ],
    fillEvery: 8,
    rollProb: 0.35,
    fillStyle: "mixed"
  },
  instruments: {
    lead: { program: 113, name: "Cowbell Lead" },
    bass: { program: 39, name: "808 Bass" },
    chords: { program: 89, name: "Dark Pad" },
    drums: { program: 0, name: "Trap Kit" }
  },
  arrange: {
    // Energy per section = terrain height (rhythm-game contract).
    layers: {
      intro: ["bass", "drums"],
      build: ["bass", "drums", "chords"],
      drop: "all",
      break: ["chords", "bass"]
    },
    sectionVelocity: { intro: 0.85, build: 0.92, break: 0.8, drop: 1.05 }
  },
  // Zero timing jitter: note.start ticks ARE the beatmap. Velocity stays loose — grime swagger.
  humanize: { timingTicks: 0, velocity: 0.12 },
  filterAutomation: {
    // Master lowpass: muffled valley in the break, sweep up through intro/build.
    target: "master",
    open: 9500,
    sections: {
      intro: { move: "sweep", fromHz: 900 },
      build: { move: "sweep", fromHz: 1e3 },
      break: { move: "closed", hz: 1200 }
    }
  },
  hooks: {
    melody: genGrimeLead
  }
};

// src/core/genres/doomerwave.ts
var DW_PULSE = {
  name: "dw-pulse",
  // Four-on-the-floor machine, snare backbeat on 2 & 4, even eighth hats.
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0]
};
var DW_DISCO = {
  name: "dw-disco",
  // Disco-rock variant: kick on 1, 3 and the classic "and of 3" syncopation.
  kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.7, 0, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
  // offbeat upbeat
};
var DW_NAMING = {
  // Translit CAPS — Молчат-Дома bleakness without Cyrillic.
  patterns: [
    { w: 3, v: "{adj} {noun}" },
    { w: 2, v: "{noun} {noun2}" },
    { w: 2, v: "POSLEDNIY {noun}" },
    { w: 1, v: "{noun} NOCHYU" }
  ],
  words: {
    adj: ["SERY", "PUSTOY", "KHOLODNY", "POSLEDNIY", "NOCHNOY", "BETONNY", "MERTVY", "TIKHIY", "TYOMNY"],
    noun: ["SUDNO", "VOLNY", "ETAZHI", "BETON", "NOCH", "GOROD", "PANELI", "TRAMVAY", "OKNO", "DOZHD", "ZIMA", "TUMAN"]
  }
};
var DW_KEYS = [
  { w: 3, v: 4 },
  // E — the Em signature (Volny)
  { w: 2, v: 9 },
  // A
  { w: 2, v: 2 },
  // D
  { w: 1, v: 11 },
  // B
  { w: 1, v: 6 }
  // F#
];
var DW_MODES = [{ w: 1, v: "naturalMinor" }];
var DW_PROGRESSIONS = [
  { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] },
  // i–VII–VI–V
  { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
  // i–VI–III–VII
  { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }] },
  // i–VII–VI–VII
  { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 4, beats: 4 }, { degree: 5, beats: 4 }, { degree: 6, beats: 4 }] },
  // i–v–VI–VII
  { w: 1, v: [{ degree: 0, beats: 8 }, { degree: 5, beats: 8 }] }
  // i–VI drone
];
var DW_INSTRUMENTS = {
  lead: { program: 88, name: "Cold Synth" },
  // mono square + portamento (makeColdLead)
  chords: { program: 91, name: "Cold Pad" },
  // slow saw pad + chorus (makeColdPad)
  arp: { program: 27, name: "Clean Guitar" },
  // chorused clean guitar (makeCleanGuitar)
  bass: { program: 33, name: "Picked Bass" },
  // picked post-punk bass + chorus (makePostPunkBass)
  drums: { program: 0, name: "Drum Machine" }
};
var NAT_MINOR = [0, 2, 3, 5, 7, 8, 10];
var MOTIFS = [
  [0, 3, 2, 0],
  [7, 8, 7, 3],
  [0, 7, 5, 3],
  [3, 2, 0, -2],
  [0, -2, -4, -5],
  [0, 3, 5, 7],
  [7, 5, 3, 2],
  [0, 5, 3, 0],
  [12, 10, 8, 7],
  [0, 2, 3, 2]
];
var LEAD_RHYTHMS = [
  [{ o: 0, d: 4 }, { o: 4, d: 4 }, { o: 8, d: 4 }, { o: 12, d: 4 }],
  // half notes
  [{ o: 0, d: 8 }, { o: 8, d: 8 }],
  // two whole notes (sparse, brooding)
  [{ o: 0, d: 2 }, { o: 2, d: 2 }, { o: 8, d: 2 }, { o: 10, d: 2 }],
  // quarter pairs
  [{ o: 0, d: 3 }, { o: 3, d: 5 }, { o: 8, d: 3 }, { o: 11, d: 5 }],
  // dotted syncopation
  [{ o: 0, d: 4 }, { o: 6, d: 2 }, { o: 8, d: 4 }, { o: 14, d: 2 }]
  // long + pickup
];
var clampReg = (p, lo, hi) => {
  while (p > hi) p -= 12;
  while (p < lo) p += 12;
  return p;
};
var genDoomerLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const [lo, hi] = ctx.cfg.melody.register;
  const eighth = PPQ / 2;
  const unit = 2 * ctx.barTicks;
  const cache = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    const secStart = section.startBar * ctx.barTicks;
    const secTicks = section.bars * ctx.barTicks;
    const cached = cache.get(sectionKey(section));
    if (cached) {
      notes.push(...cached.map((n) => ({ ...n, start: n.start + secStart })));
      continue;
    }
    const motif = rng.pick(MOTIFS);
    const rhythm = rng.pick(LEAD_RHYTHMS);
    const octave = (section.name === "chorus" || section.name === "drop") && rng.chance(0.6) ? 12 : 0;
    const base = clampReg(ctx.key.tonic + octave, lo, hi - 12 < lo ? lo : lo + 4);
    const secNotes = [];
    const units = Math.ceil(section.bars / 2);
    for (let u = 0; u < units; u++) {
      const uStart = u * unit;
      for (let k = 0; k < rhythm.length; k++) {
        const slot = rhythm[k];
        const onset = uStart + slot.o * eighth;
        if (onset >= secTicks) continue;
        let deg = motif[k % motif.length];
        if (k === rhythm.length - 1 && u % 4 === 3) deg += NAT_MINOR[1];
        const dur = Math.min(slot.d * eighth - 10, secTicks - onset);
        secNotes.push({
          pitch: clampReg(base + deg, lo, hi),
          start: onset,
          dur: Math.max(30, dur),
          vel: k === 0 ? 100 : 90
        });
      }
    }
    cache.set(sectionKey(section), secNotes);
    notes.push(...secNotes.map((n) => ({ ...n, start: n.start + secStart })));
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "lead", notes };
};
function gtrCycle(shape, voicing) {
  switch (shape) {
    case "down":
      return [...voicing].reverse();
    case "updown":
      return voicing.length > 2 ? [...voicing, ...voicing.slice(1, -1).reverse()] : voicing;
    case "pedal": {
      const top = voicing[voicing.length - 1];
      const out = [];
      for (const p of voicing.slice(0, -1)) out.push(top, p);
      return out.length ? out : voicing;
    }
    default:
      return voicing;
  }
}
var genDoomerGuitar = (ctx) => {
  const inst = ctx.cfg.instruments.arp;
  if (!inst) return null;
  const rng = ctx.rng("comping");
  const [lo, hi] = ctx.cfg.arp?.register ?? [72, 91];
  const eighth = PPQ / 2;
  const s16 = PPQ / 4;
  const notes = [];
  const SHAPES = ["up", "down", "updown", "pedal", "stabs"];
  const shapeByName = /* @__PURE__ */ new Map();
  const sectionNameAt2 = (tick) => {
    for (let i = ctx.sections.length - 1; i >= 0; i--) {
      const s = ctx.sections[i];
      if (tick >= s.startBar * ctx.barTicks) return s.name;
    }
    return ctx.sections[0].name;
  };
  const shapeFor = (name) => {
    let sh = shapeByName.get(name);
    if (!sh) {
      sh = rng.pick(SHAPES);
      shapeByName.set(name, sh);
    }
    return sh;
  };
  for (const span of ctx.chords) {
    const name = sectionNameAt2(span.start);
    const peak = name === "chorus" || name === "drop";
    const voicing = closeVoicing(span.chord, lo).filter((p) => p <= hi);
    if (voicing.length === 0) continue;
    const top = voicing[voicing.length - 1];
    if (peak) {
      const count = Math.floor(span.dur / s16);
      for (let i = 0; i < count; i++) {
        notes.push({ pitch: top, start: span.start + i * s16, dur: s16, vel: i % 4 === 0 ? 78 : 66 });
      }
      continue;
    }
    const shape = shapeFor(name);
    if (shape === "stabs") {
      const beats = Math.floor(span.dur / ctx.beatTicks);
      for (let b = 0; b < beats; b++) {
        const start = span.start + b * ctx.beatTicks;
        for (const pitch of voicing) {
          notes.push({ pitch, start, dur: Math.floor(ctx.beatTicks * 0.5), vel: b % 2 === 0 ? 72 : 60 });
        }
      }
    } else {
      const seq = gtrCycle(shape, voicing);
      const count = Math.floor(span.dur / eighth);
      for (let i = 0; i < count; i++) {
        notes.push({
          pitch: seq[i % seq.length],
          start: span.start + i * eighth,
          dur: eighth * 2,
          // overlap → delay/reverb wash
          vel: i % seq.length === 0 ? 74 : 62
        });
      }
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "arp", notes };
};
var DOOMERWAVE = {
  id: "doomerwave",
  name: "Doomerwave",
  naming: DW_NAMING,
  bpm: [110, 132],
  timeSig: [4, 4],
  keys: DW_KEYS,
  modes: DW_MODES,
  swing: [0, 0],
  structures: [
    {
      w: 2,
      v: [
        { name: "intro", bars: 8 },
        { name: "verse", bars: 16 },
        { name: "prechorus", bars: 4 },
        { name: "chorus", bars: 16 },
        { name: "verse", bars: 16 },
        { name: "chorus", bars: 16 },
        { name: "outro", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 8 },
        { name: "verse", bars: 16 },
        { name: "chorus", bars: 16 },
        { name: "prechorus", bars: 4 },
        { name: "chorus", bars: 16 },
        { name: "outro", bars: 8 }
      ]
    }
  ],
  progressions: DW_PROGRESSIONS,
  distinctProgressions: true,
  melody: {
    register: [64, 79],
    // cold ostinato synth
    density: 0.4,
    leapProb: 0.1,
    restProb: 0.2,
    syncopation: 0.15
  },
  bass: { style: "gallop", register: [33, 57] },
  // melodic galloping post-punk bass (root + octave pops)
  comping: { register: [52, 72], style: "sustained" },
  // cold-wave pad
  arp: { register: [72, 91], rate: 4 },
  // clean guitar (genDoomerGuitar hook)
  drums: {
    patterns: [
      { w: 2, v: DW_PULSE },
      { w: 1, v: DW_DISCO }
    ],
    fillEvery: 8,
    fillStyle: "toms"
  },
  instruments: DW_INSTRUMENTS,
  arrange: {
    // Hypnotic layering: bare bass+drums → guitar → +lead → full chorus → bass.
    layers: {
      // Intro sets the melancholy first: cold pad + ringing guitar over the
      // beat, no lead yet. Verse cools (synths drop) for the "vocal" space.
      intro: ["bass", "drums", "arp", "chords"],
      verse: ["bass", "drums", "arp"],
      prechorus: ["bass", "drums", "arp", "lead"],
      chorus: "all",
      outro: ["bass"]
      // loop-safe thin outro: bass alone leads back to bar 1
    },
    sectionVelocity: { intro: 0.72, verse: 0.85, prechorus: 0.92, chorus: 1, outro: 0.68 }
  },
  // Mechanical drum machine — strictly on the grid; velocity barely breathes.
  humanize: { timingTicks: 0, velocity: 0.04 },
  hooks: {
    melody: genDoomerLead,
    arp: genDoomerGuitar
  }
};

// src/core/genres/doomerrun.ts
var RUN_PULSE = {
  name: "run-pulse",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0, 0.6, 0, 0.4, 0]
};
var RUN_DRIVE = {
  name: "run-drive",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0.6],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.6, 0.3, 0.4, 0.3, 0.6, 0.3, 0.4, 0.3, 0.6, 0.3, 0.4, 0.3, 0.6, 0.3, 0.4, 0.3],
  hatOpen: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]
};
var DOOMERRUN = {
  id: "doomerrun",
  name: "Doomer Run",
  naming: DW_NAMING,
  bpm: [122, 138],
  timeSig: [4, 4],
  keys: DW_KEYS,
  modes: DW_MODES,
  swing: [0, 0],
  structures: [
    // The shared rhythm-game arc: quiet valley (break) between two peaks.
    {
      w: 2,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      // Long brooding opener into one extended 16-bar drop (single drop).
      w: 1,
      v: [
        { name: "intro", bars: 8 },
        { name: "build", bars: 8 },
        { name: "drop", bars: 16 },
        { name: "break", bars: 8 }
      ]
    },
    {
      // Two short drops around a long valley.
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 12 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    }
  ],
  progressions: DW_PROGRESSIONS,
  distinctProgressions: true,
  melody: {
    register: [64, 79],
    density: 0.4,
    leapProb: 0.1,
    restProb: 0.2,
    syncopation: 0.15
  },
  bass: { style: "gallop", register: [33, 57] },
  comping: { register: [52, 72], style: "sustained" },
  arp: { register: [72, 91], rate: 4 },
  drums: {
    patterns: [
      { w: 2, v: RUN_PULSE },
      { w: 1, v: RUN_DRIVE }
    ],
    fillEvery: 8,
    fillStyle: "toms"
  },
  instruments: DW_INSTRUMENTS,
  arrange: {
    // Energy per section = terrain height (rhythm-game contract).
    layers: {
      // Atmospheric intro: cold pad + guitar over the beat (melancholy first).
      intro: ["bass", "drums", "arp", "chords"],
      build: ["bass", "drums", "arp", "chords"],
      drop: "all",
      break: ["chords", "bass", "arp"]
    },
    sectionVelocity: { intro: 0.74, build: 0.9, break: 0.78, drop: 1 }
  },
  // Zero timing jitter: note.start ticks ARE the beatmap.
  humanize: { timingTicks: 0, velocity: 0.04 },
  filterAutomation: {
    // Master lowpass, dark ceiling: grey valley in the break, sweep through build.
    target: "master",
    open: 7e3,
    sections: {
      intro: { move: "sweep", fromHz: 700 },
      build: { move: "sweep", fromHz: 900 },
      break: { move: "closed", hz: 1100 }
    }
  },
  hooks: {
    melody: genDoomerLead,
    arp: genDoomerGuitar
  }
};

// src/core/genres/nightcorerun.ts
var NCR_KIT = {
  name: "ncr-kit",
  kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
  hatClosed: [0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0, 0.6, 0, 0.5, 0]
};
var placeRoot = (pc, lo, hi) => {
  for (let p = lo; p <= hi; p++) if (mod12(p) === (pc % 12 + 12) % 12) return p;
  return lo;
};
var sectionNameAt = (ctx, tick) => {
  for (let i = ctx.sections.length - 1; i >= 0; i--) {
    const s = ctx.sections[i];
    if (tick >= s.startBar * ctx.barTicks) return s.name;
  }
  return ctx.sections[0].name;
};
var GTR_RHYTHMS = [
  // straight chug (1/8)
  [{ off: 0, len: 2, vel: 100 }, { off: 2, len: 2, vel: 90 }],
  // metal gallop (1/8 + 1/16 + 1/16)
  [{ off: 0, len: 2, vel: 104 }, { off: 2, len: 1, vel: 90 }, { off: 3, len: 1, vel: 88 }],
  // reverse gallop (1/16 1/16 + 1/8)
  [{ off: 0, len: 1, vel: 96 }, { off: 1, len: 1, vel: 86 }, { off: 2, len: 2, vel: 100 }],
  // syncopated palm-mute (off the downbeat)
  [{ off: 0, len: 1, vel: 102 }, { off: 2, len: 1, vel: 84 }, { off: 3, len: 1, vel: 92 }],
  // driving 1/16 (all four)
  [{ off: 0, len: 1, vel: 100 }, { off: 1, len: 1, vel: 82 }, { off: 2, len: 1, vel: 92 }, { off: 3, len: 1, vel: 84 }]
];
var genNCRGuitar = (ctx) => {
  const inst = ctx.cfg.instruments.arp;
  if (!inst) return null;
  const rng = ctx.rng("comping");
  const [lo, hi] = ctx.cfg.arp?.register ?? [40, 64];
  const s16 = PPQ / 4;
  const notes = [];
  const cellByName = /* @__PURE__ */ new Map();
  const rhythmFor = (name) => {
    let c = cellByName.get(name);
    if (!c) {
      c = name === "drop" ? rng.pick([GTR_RHYTHMS[1], GTR_RHYTHMS[1], GTR_RHYTHMS[4], GTR_RHYTHMS[2]]) : rng.pick(GTR_RHYTHMS);
      cellByName.set(name, c);
    }
    return c;
  };
  const chord = (start, dur, vel, root, fifth) => {
    notes.push({ pitch: root, start, dur, vel });
    notes.push({ pitch: fifth, start, dur, vel: vel - 4 });
  };
  for (const span of ctx.chords) {
    const name = sectionNameAt(ctx, span.start);
    if (name === "intro" || name === "break") continue;
    const cells = rhythmFor(name);
    const root = placeRoot(span.chord.root, lo, hi);
    const fifth = root + 7 <= hi ? root + 7 : root;
    const beats = Math.floor(span.dur / ctx.beatTicks);
    for (let b = 0; b < beats; b++) {
      const beatStart = span.start + b * ctx.beatTicks;
      for (const cell of cells) {
        chord(beatStart + cell.off * s16, cell.len * s16 - 8, cell.vel, root, fifth);
      }
    }
  }
  return { name: inst.name, channel: 0, program: inst.program, role: "arp", notes };
};
var genNCRDrums = (ctx) => {
  const inst = ctx.cfg.instruments.drums;
  if (!inst) return null;
  const rng = ctx.rng("drums");
  const step = ctx.barTicks / 16;
  const beat = ctx.beatTicks;
  const jit = () => rng.int(-4, 4);
  const notes = [];
  const hit = (pitch, start, dur, vel) => {
    notes.push({ pitch, start, dur, vel: Math.max(1, Math.min(127, vel)) });
  };
  const dropStepByName = /* @__PURE__ */ new Map();
  const dropStep = (name) => {
    let d = dropStepByName.get(name);
    if (d === void 0) {
      d = rng.pick([1, 1, 2]);
      dropStepByName.set(name, d);
    }
    return d;
  };
  const toms = [GM_DRUMS.tomHigh, GM_DRUMS.tomMid, GM_DRUMS.tomLow];
  for (const section of ctx.sections) {
    for (let bar = 0; bar < section.bars; bar++) {
      const barStart = (section.startBar + bar) * ctx.barTicks;
      const lastBar = bar === section.bars - 1;
      if (bar === 0) hit(GM_DRUMS.crash, barStart, beat, 106 + jit());
      if (section.name === "drop") {
        const kd = dropStep(sectionKey(section));
        for (let s = 0; s < 16; s += kd) hit(GM_DRUMS.kick, barStart + s * step, step - 10, 92 + jit());
        hit(GM_DRUMS.snare, barStart + 4 * step, step, 114 + jit());
        hit(GM_DRUMS.snare, barStart + 12 * step, step, 114 + jit());
        for (const s of [2, 6, 10, 14]) hit(GM_DRUMS.hatOpen, barStart + s * step, step, 72 + jit());
        if (bar % 2 === 0) hit(GM_DRUMS.crash, barStart, beat, 92 + jit());
        if (lastBar) {
          for (let s = 12; s < 16; s++) {
            hit(toms[(s - 12) % 3], barStart + s * step, step - 6, 100 + jit());
          }
        }
      } else if (section.name === "build") {
        for (const s of [0, 4, 8, 12]) hit(GM_DRUMS.kick, barStart + s * step, step - 10, 100 + jit());
        const lastBar2 = bar === section.bars - 1;
        for (let s = 0; s < 16; s++) {
          const vel = 56 + Math.round(s / 15 * 56);
          hit(GM_DRUMS.snare, barStart + s * step, step - 8, vel);
          if (lastBar2 && s >= 8) hit(GM_DRUMS.snare, barStart + s * step + step / 2, step / 2, vel + 6);
        }
      } else if (section.name === "break") {
        for (const s of [0, 4, 8, 12]) hit(GM_DRUMS.kick, barStart + s * step, step - 10, 88 + jit());
        hit(GM_DRUMS.snare, barStart + 4 * step, step, 96 + jit());
        hit(GM_DRUMS.snare, barStart + 12 * step, step, 96 + jit());
        for (const s of [2, 6, 10, 14]) hit(GM_DRUMS.hatClosed, barStart + s * step, step - 6, 54 + jit());
      }
    }
  }
  return { name: inst.name, channel: DRUM_CHANNEL, program: inst.program, role: "drums", notes };
};
var HOLD_SHAPES = [
  [{ off: 0, len: 4 }],
  // one whole-bar swell
  [{ off: 0, len: 2 }, { off: 2, len: 2 }],
  // two half notes
  [{ off: 0, len: 3 }, { off: 3, len: 1 }],
  // long + pickup
  [{ off: 0, len: 1 }, { off: 1, len: 1 }, { off: 2, len: 2 }],
  // two short + held
  [{ off: 0, len: 2 }, { off: 2, len: 1 }, { off: 3, len: 1 }],
  // half + two quarters
  [{ off: 1, len: 3 }]
  // delayed swell (rest on beat 1)
];
var NCR_LEAD_PROGRAMS = [49, 49, 48, 40, 1];
function ncrPhrase(rng, ctx, anchorTick) {
  const [lo, hi] = ctx.cfg.melody.register;
  const tonic = ctx.key.tonic;
  const mode = ctx.key.mode;
  const beat = ctx.beatTicks;
  const s16 = PPQ / 4;
  const out = [];
  const shape = rng.pick(HOLD_SHAPES);
  let cur = clampRegister(nearestChordTone(hi - rng.int(0, 6), ctx.chordAt(anchorTick)), lo, hi);
  for (const h of shape) {
    const t = h.off * beat;
    const chord = ctx.chordAt(anchorTick + t);
    cur = clampRegister(nearestChordTone(cur + rng.int(-2, 2), chord), lo, hi);
    out.push({ pitch: cur, start: t, dur: h.len * beat - 20, vel: 100 + rng.int(-4, 4) });
  }
  const start16 = rng.int(0, 4);
  const flip = rng.int(6, 11);
  let dir = rng.chance(0.5) ? 1 : -1;
  for (let i = start16; i < 16; i++) {
    if (i === flip) dir = dir === 1 ? -1 : 1;
    cur = clampRegister(nextScalePitch(cur, dir, tonic, mode), lo, hi);
    const last = i === 15;
    if (last) cur = clampRegister(nearestChordTone(cur, ctx.chordAt(anchorTick + ctx.barTicks)), lo, hi);
    out.push({
      pitch: cur,
      start: ctx.barTicks + i * s16,
      dur: last ? beat : s16 - 5,
      vel: last ? 104 : 80 + rng.int(-4, 8)
    });
  }
  return out;
}
var genNCRLead = (ctx) => {
  const inst = ctx.cfg.instruments.lead;
  if (!inst) return null;
  const rng = ctx.rng("melody");
  const program = rng.pick(NCR_LEAD_PROGRAMS);
  const unit = 2 * ctx.barTicks;
  const cache = /* @__PURE__ */ new Map();
  const notes = [];
  for (const section of ctx.sections) {
    const secStart = section.startBar * ctx.barTicks;
    const secTicks = section.bars * ctx.barTicks;
    const cached = cache.get(sectionKey(section));
    if (cached) {
      notes.push(...cached.map((n) => ({ ...n, start: n.start + secStart })));
      continue;
    }
    const units = Math.ceil(section.bars / 2);
    const phraseA = ncrPhrase(rng, ctx, secStart);
    const phraseB = ncrPhrase(rng, ctx, secStart);
    const secNotes = [];
    for (let u = 0; u < units; u++) {
      const uStart = u * unit;
      const ph = u % 4 === 2 ? phraseB : phraseA;
      for (const n of ph) {
        if (uStart + n.start >= secTicks) continue;
        secNotes.push({ ...n, start: uStart + n.start });
      }
    }
    cache.set(sectionKey(section), secNotes);
    notes.push(...secNotes.map((n) => ({ ...n, start: n.start + secStart })));
  }
  return { name: inst.name, channel: 0, program, role: "lead", notes };
};
var NIGHTCORERUN = {
  id: "nightcorerun",
  name: "Nightcore Run",
  naming: {
    patterns: [
      { w: 3, v: "{adj} {noun} \u2665" },
      { w: 2, v: "{adj} {noun}!!" },
      { w: 2, v: "ETERNAL {noun} \u2606" },
      { w: 1, v: "{noun} {noun2} (opening)" }
    ],
    words: {
      adj: ["crimson", "eternal", "shattered", "radiant", "fated", "midnight", "azure", "blazing", "silver", "last"],
      noun: ["requiem", "resolve", "horizon", "crusade", "oath", "destiny", "storm", "wings", "velocity", "genesis"]
    }
  },
  bpm: [165, 190],
  timeSig: [4, 4],
  keys: [
    { w: 3, v: 9 },
    // A
    { w: 2, v: 4 },
    // E
    { w: 2, v: 2 },
    // D
    { w: 2, v: 11 },
    // B
    { w: 1, v: 6 }
    // F#
  ],
  modes: [
    { w: 2, v: "naturalMinor" },
    { w: 2, v: "harmonicMinor" }
    // raised leading-tone drama
  ],
  swing: [0, 0],
  structures: [
    // Anime-opening arc on the shared rhythm-game skeleton.
    {
      w: 2,
      v: [
        { name: "intro", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      // Double-build tension stacker.
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    },
    {
      // Long opener, single huge chorus, verse, final chorus.
      w: 1,
      v: [
        { name: "intro", bars: 8 },
        { name: "drop", bars: 16 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 16 }
      ]
    },
    {
      // Two verses between choruses.
      w: 1,
      v: [
        { name: "intro", bars: 4 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 },
        { name: "break", bars: 8 },
        { name: "build", bars: 4 },
        { name: "drop", bars: 8 }
      ]
    }
  ],
  progressions: [
    // Royal Road and metal/anime minor squares (major dominant ends some).
    { w: 3, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 2, beats: 4 }, { degree: 6, beats: 4 }] },
    // i–VI–III–VII
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 5, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–VI–iv–V
    { w: 2, v: [{ degree: 0, beats: 4 }, { degree: 6, beats: 4 }, { degree: 5, beats: 4 }, { degree: 4, beats: 4 }] },
    // i–VII–VI–V
    { w: 1, v: [{ degree: 0, beats: 4 }, { degree: 3, beats: 4 }, { degree: 4, beats: 4 }, { degree: 4, beats: 4 }] }
    // i–iv–V–V
  ],
  distinctProgressions: true,
  melody: {
    register: [76, 96],
    // the pitched-up anime vocal / shred register
    density: 0.7,
    leapProb: 0.3,
    restProb: 0.05,
    syncopation: 0.4
  },
  bass: { style: "chug", register: [33, 50] },
  // picked metal bass, doubles the guitar
  comping: { register: [60, 84], style: "sustained" },
  // orchestral strings bed
  arp: { register: [40, 64], rate: 8 },
  // rhythm guitar power-chord register
  drums: { patterns: [{ w: 1, v: NCR_KIT }], fillEvery: 8 },
  instruments: {
    lead: { program: 49, name: "Symphonic Lead" },
    // makeSymphonicLead (hall reverb)
    chords: { program: 48, name: "Strings" },
    // GM Strings (makeStrings section)
    arp: { program: 30, name: "Power Guitar" },
    // makePowerGuitar (distortion, double-tracked)
    bass: { program: 34, name: "Metal Bass" },
    // makeMetalBass (picked + overdrive)
    drums: { program: 0, name: "Metal Kit" }
  },
  arrange: {
    // Emotional swing: orchestral intro → guitar build → wall-of-sound drop →
    // verse valley (no guitars) → drop.
    layers: {
      intro: ["lead", "chords"],
      // piano/strings + pitched lead, no rhythm section
      build: ["arp", "bass", "drums", "chords"],
      drop: "all",
      break: ["bass", "chords"]
      // rhythm guitars gone; bass + symphonic pad
    },
    sectionVelocity: { intro: 0.72, build: 0.9, break: 0.78, drop: 1.05 }
  },
  // Beatmap grid: zero timing jitter; velocity breathes for a "live" drummer.
  humanize: { timingTicks: 0, velocity: 0.08 },
  hooks: {
    arp: genNCRGuitar,
    drums: genNCRDrums,
    melody: genNCRLead
  }
};

// src/core/genres/test.ts
var ALLOW = {
  DALL: null,
  // everything (reproduces the fart)
  DKICK: [36],
  DSNARE: [38],
  DHATS: [42, 46],
  DTOMS: [45, 47, 50],
  // fills
  DCRASH: [49],
  DKS: [36, 38],
  // kick + snare
  DKH: [36, 42, 46]
  // kick + hats
};
var genTestDrums = (ctx) => {
  const full = genDrums(ctx);
  if (!full) return null;
  const secAt = (tick) => [...ctx.sections].reverse().find((s) => tick >= s.startBar * ctx.barTicks) ?? ctx.sections[0];
  const notes = full.notes.filter((n) => {
    const a = ALLOW[secAt(n.start).name];
    return a === null || a === void 0 || a.includes(n.pitch);
  });
  if (notes.length === 0) notes.push(full.notes[0]);
  return { ...full, notes };
};
var NAMES = Object.keys(ALLOW);
var layers = {};
for (const n of NAMES) layers[n] = ["drums"];
var TEST = {
  ...GRIMERUN,
  id: "test",
  name: "Test (diagnostic)",
  structures: [{ w: 1, v: NAMES.map((name) => ({ name, bars: 2 })) }],
  arrange: { layers },
  filterAutomation: void 0,
  // pure mix test, no master sweep
  hooks: { ...GRIMERUN.hooks, drums: genTestDrums }
};

// src/core/genres/index.ts
var GENRES = {
  keygen: KEYGEN,
  grime: GRIME,
  phonk: PHONK,
  noir: NOIR,
  anime: ANIME,
  blues: BLUES,
  military: MILITARY,
  darkacademia: DARKACADEMIA,
  nightcore: NIGHTCORE,
  tune: TUNE,
  musicbox: MUSICBOX,
  eurobeat: EUROBEAT,
  outrun: OUTRUN,
  grimerun: GRIMERUN,
  doomerwave: DOOMERWAVE,
  doomerrun: DOOMERRUN,
  nightcorerun: NIGHTCORERUN,
  test: TEST
};
function getGenre(id) {
  const cfg = GENRES[id];
  if (!cfg) throw new Error(`genre "${id}" is not implemented yet`);
  return cfg;
}
function listGenres() {
  return Object.values(GENRES).filter((c) => !c.hidden).map((c) => ({ id: c.id, name: c.name, bpm: c.bpm }));
}

export {
  __esm,
  __commonJS,
  __export,
  __toESM,
  __toCommonJS,
  GENRE_IDS,
  sectionKey,
  PPQ,
  DRUM_CHANNEL,
  mod12,
  genMelody,
  chordFromDegree,
  closeVoicing,
  GM_DRUMS,
  genDrums,
  expandProgression,
  getGenre,
  listGenres
};
//# sourceMappingURL=chunk-YYIEHPBL.js.map