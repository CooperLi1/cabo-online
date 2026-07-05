'use client';
// Tiny WebAudio synth — soft pastel blips, no asset files.
import { getAudioSettings } from './audio';

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq: number, dur = 0.12, type: OscillatorType = 'sine', vol = 0.16, when = 0, glide?: number) {
  const level = getAudioSettings().sfx;
  if (level <= 0) return;
  vol *= level;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur = 0.08, vol = 0.06, when = 0) {
  const level = getAudioSettings().sfx;
  if (level <= 0) return;
  vol *= level;
  const a = ac();
  if (!a) return;
  const t = a.currentTime + when;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 1200;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

export const sfx = {
  click: () => tone(660, 0.06, 'sine', 0.1),
  pop: () => { tone(720, 0.055, 'triangle', 0.08); tone(1060, 0.08, 'sine', 0.06, 0.035); },
  deal: () => { for (let i = 0; i < 4; i++) noise(0.06, 0.05, i * 0.09); },
  flip: () => { noise(0.05, 0.05); tone(880, 0.07, 'sine', 0.06); },
  draw: () => { noise(0.06, 0.05); tone(520, 0.09, 'triangle', 0.1, 0, 700); },
  discard: () => { noise(0.05, 0.05); tone(440, 0.1, 'triangle', 0.09, 0, 330); },
  swap: () => { tone(520, 0.08, 'sine', 0.09); tone(660, 0.08, 'sine', 0.09, 0.08); },
  peek: () => { tone(760, 0.1, 'sine', 0.08, 0, 980); },
  snapHit: () => { tone(880, 0.09, 'square', 0.06); tone(1320, 0.14, 'square', 0.05, 0.07); noise(0.05, 0.08); },
  snapMiss: () => { tone(300, 0.18, 'sawtooth', 0.06, 0, 160); },
  cabo: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.1, i * 0.09)); },
  turn: () => tone(587, 0.1, 'sine', 0.07, 0, 740),
  give: () => tone(494, 0.1, 'sine', 0.08, 0, 392),
  win: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.09, i * 0.11)); },
  lose: () => { [392, 330, 262].forEach((f, i) => tone(f, 0.22, 'triangle', 0.07, i * 0.14)); },
};
