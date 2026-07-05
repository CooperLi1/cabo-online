'use client';
import { useEffect, useRef, useState } from 'react';
import { getAudioSettings, saveAudioSettings } from '@/lib/audio';
import { setMusicVolume, startMusic } from '@/lib/music';
import { sfx } from '@/lib/sounds';

export function AudioControl() {
  const [open, setOpen] = useState(false);
  const [music, setMusic] = useState(0.5);
  const [sfxVol, setSfxVol] = useState(0.8);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = getAudioSettings();
    setMusic(s.music);
    setSfxVol(s.sfx);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const silent = music <= 0 && sfxVol <= 0;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="btn btn-small btn-round"
        title="audio settings"
        onClick={() => { setOpen((o) => !o); startMusic(); }}
      >
        {silent ? '🔇' : '🔊'}
      </button>
      {open && (
        <div className="audio-pop">
          <label className="audio-row">
            <span>music</span>
            <input
              type="range" min={0} max={1} step={0.05} value={music}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setMusic(v);
                saveAudioSettings({ music: v });
                setMusicVolume(v);
              }}
            />
          </label>
          <label className="audio-row">
            <span>sfx</span>
            <input
              type="range" min={0} max={1} step={0.05} value={sfxVol}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setSfxVol(v);
                saveAudioSettings({ sfx: v });
              }}
              onPointerUp={() => sfx.click()}
            />
          </label>
        </div>
      )}
    </div>
  );
}
