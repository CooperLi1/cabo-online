'use client';
// Shared audio settings, persisted in the browser.

export interface AudioSettings {
  music: number; // 0..1
  sfx: number;   // 0..1
}

const KEY = 'cabo-audio';
const DEFAULTS: AudioSettings = { music: 0.5, sfx: 0.8 };

let cache: AudioSettings | null = null;

export function getAudioSettings(): AudioSettings {
  if (cache) return cache;
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    cache = {
      music: typeof saved?.music === 'number' ? Math.min(Math.max(saved.music, 0), 1) : DEFAULTS.music,
      sfx: typeof saved?.sfx === 'number' ? Math.min(Math.max(saved.sfx, 0), 1) : DEFAULTS.sfx,
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function saveAudioSettings(next: Partial<AudioSettings>) {
  cache = { ...getAudioSettings(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
  return cache;
}
