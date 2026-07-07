'use client';
// A tiny generative chiptune loop — synthesized live with WebAudio, no files.
// Music-box arpeggios over a soft triangle bass, Cmaj7/Am7/Fmaj7/G, with a
// gentle echo. Volume settings persist in localStorage (see audio.ts).

import { getAudioSettings } from './audio';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let nextStepTime = 0;
let step = 0;
let running = false;

const BPM = 96;
const STEP = 60 / BPM / 2; // 8th notes
const BASE_VOL = 0.5;

// chord tones as midi notes; 4 bars, 8 steps per bar
const CHORDS = [
  { arp: [60, 67, 64, 67, 72, 67, 64, 67], bass: [36, 43] }, // Cmaj
  { arp: [57, 64, 60, 64, 69, 64, 60, 64], bass: [33, 40] }, // Am
  { arp: [57, 65, 60, 65, 69, 65, 60, 65], bass: [29, 36] }, // F
  { arp: [59, 67, 62, 67, 71, 67, 62, 67], bass: [31, 38] }, // G
];
// every other 4-bar pass, the arp floats an octave up for sparkle
const SPARKLE_PASS = 1;

function freq(midi: number) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = BASE_VOL * getAudioSettings().music;
    // soft echo for dreaminess
    const delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    master.connect(ctx.destination);
    master.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function note(midi: number, t: number, dur: number, vol: number, type: OscillatorType) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq(midi);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function scheduleStep(s: number, t: number) {
  const totalSteps = CHORDS.length * 8; // 32 steps per pass
  const pass = Math.floor(s / totalSteps) % 2;
  const inPass = s % totalSteps;
  const bar = Math.floor(inPass / 8);
  const i = inPass % 8;
  const chord = CHORDS[bar];

  // music-box arp (skip a couple of steps for breathing room)
  if (!(i === 3 && bar % 2 === 1)) {
    const lift = pass === SPARKLE_PASS && bar >= 2 ? 12 : 0;
    note(chord.arp[i] + lift, t, STEP * 2.4, 0.055, 'sine');
    note(chord.arp[i] + lift + 12, t, STEP * 1.2, 0.012, 'triangle'); // faint shimmer
  }
  // bass on beats 1 and 3
  if (i === 0) note(chord.bass[0], t, STEP * 3.4, 0.075, 'triangle');
  if (i === 4) note(chord.bass[1], t, STEP * 3.4, 0.06, 'triangle');
}

export function startMusic() {
  if (getAudioSettings().music <= 0) return;
  const a = ensureCtx();
  if (!a || running) return;
  running = true;
  nextStepTime = a.currentTime + 0.1;
  step = 0;
  schedulerTimer = setInterval(() => {
    if (!ctx) return;
    // if the tab was throttled/hidden, skip the missed steps instead of
    // burst-playing them all at once on return
    if (nextStepTime < ctx.currentTime - 0.3) nextStepTime = ctx.currentTime + 0.05;
    while (nextStepTime < ctx.currentTime + 0.18) {
      scheduleStep(step, nextStepTime);
      step++;
      nextStepTime += STEP;
    }
  }, 60);
}

export function stopMusic() {
  running = false;
  if (schedulerTimer) clearInterval(schedulerTimer);
  schedulerTimer = null;
}

export function setMusicVolume(v: number) {
  if (master && ctx) master.gain.setTargetAtTime(BASE_VOL * v, ctx.currentTime, 0.05);
  if (v > 0 && !running) startMusic();
  if (v <= 0 && running) stopMusic();
}

export function isMusicRunning() {
  return running;
}
