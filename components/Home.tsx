'use client';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { PixelAvatar, AVATAR_IDS, avatarName } from './PixelAvatar';
import { PixelSprite, CLOUD, SPARKLE } from './PixelSprite';
import { PlayingCard } from './PlayingCard';
import { AudioControl } from './AudioControl';

export function PixelClouds() {
  return (
    <>
      <PixelSprite grid={CLOUD} color="#ffffff" size={130} className="deco deco-cloud" style={{ top: '9%', animationDuration: '75s', opacity: 0.9 }} />
      <PixelSprite grid={CLOUD} color="#ffffff" size={90} className="deco deco-cloud" style={{ top: '22%', animationDuration: '110s', animationDelay: '-40s', opacity: 0.7 }} />
      <PixelSprite grid={CLOUD} color="#ffe4ee" size={160} className="deco deco-cloud" style={{ top: '4%', animationDuration: '95s', animationDelay: '-70s', opacity: 0.8 }} />
      <PixelSprite grid={SPARKLE} color="#f5c94f" size={18} className="deco float-bob" style={{ top: '16%', left: '12%' }} />
      <PixelSprite grid={SPARKLE} color="#b9a6ee" size={13} className="deco float-bob" style={{ top: '30%', right: '14%', animationDelay: '0.6s' }} />
      <PixelSprite grid={SPARKLE} color="#ff8fab" size={15} className="deco float-bob" style={{ bottom: '18%', left: '8%', animationDelay: '1.1s' }} />
    </>
  );
}

export function Home({
  onJoined,
  onTutorial,
}: {
  onJoined: (res: { pid: string; token: string; code: string }) => void;
  onTutorial: () => void;
}) {
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('cat');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(localStorage.getItem('cabo-name') || '');
    setAvatar(localStorage.getItem('cabo-avatar') || AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)]);
    const url = new URL(window.location.href);
    const j = url.searchParams.get('join');
    if (j) setCode(j.toUpperCase());
  }, []);

  const persist = () => {
    localStorage.setItem('cabo-name', name.trim());
    localStorage.setItem('cabo-avatar', avatar);
  };

  // if the server can't be reached (e.g. a host without websocket support),
  // fail loudly instead of hanging on a disabled button
  const attempt = (event: string, payload: Record<string, string | number>) => {
    persist();
    setBusy(true);
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      setBusy(false);
      setError("can't reach the game server 😢 (it needs a Node host, not serverless)");
    }, 6000);
    getSocket().emit(event, payload, (res: { ok?: boolean; error?: string; pid?: string; token?: string; code?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      setBusy(false);
      if (res.ok) { sfx.click(); onJoined({ pid: res.pid!, token: res.token!, code: res.code! }); }
      else setError(res.error || 'something went wrong');
    });
  };

  const create = () => {
    if (!name.trim()) return setError('pick a name first!');
    attempt('create', { name: name.trim(), avatar });
  };

  const join = () => {
    if (!name.trim()) return setError('pick a name first!');
    if (code.trim().length !== 4) return setError('codes are 4 letters!');
    attempt('join', { code: code.trim().toUpperCase(), name: name.trim(), avatar });
  };

  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-5 px-4 relative overflow-hidden">
      <PixelClouds />
      <div style={{ position: 'fixed', top: 12, right: 14, zIndex: 30 }}><AudioControl /></div>

      {/* floating deco cards */}
      <div className="deco float-bob-smooth" style={{ left: '9%', top: '38%', rotate: '-10deg', position: 'fixed' }}>
        <PlayingCard id="deco1" noLayout card={{ id: 'deco1', r: 'K', s: '♥' }} size="md" />
      </div>
      <div className="deco float-bob-smooth" style={{ right: '9%', top: '48%', rotate: '12deg', position: 'fixed', animationDelay: '0.9s' }}>
        <PlayingCard id="deco2" noLayout size="md" />
      </div>

      <motion.div
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="text-center"
      >
        <h1 className="logo">cabo!</h1>
      </motion.div>

      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.08 }}
        className="flex flex-col items-center gap-4 w-full max-w-sm"
      >
        {/* avatar picker */}
        <div className="grid grid-cols-5 gap-2">
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              className={`avatar-pick ${avatar === id ? 'picked' : ''}`}
              onClick={() => { setAvatar(id); sfx.click(); }}
              aria-label={avatarName(id)}
              title={avatarName(id)}
            >
              <PixelAvatar id={id} size={40} />
            </button>
          ))}
        </div>

        <input
          className="input w-full text-center"
          placeholder="your name"
          maxLength={14}
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && (code ? join() : create())}
        />

        <button className="btn btn-primary w-full text-lg" onClick={create} disabled={busy}>
          ✦ new game
        </button>

        <div className="flex gap-2 w-full">
          <input
            className="input flex-1 text-center tracking-[0.3em] uppercase"
            placeholder="CODE"
            maxLength={4}
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button className="btn btn-mint" onClick={join} disabled={busy}>join</button>
        </div>

        {error && <div className="text-[var(--pink-deep)] font-bold">{error}</div>}

        <button className="btn btn-small btn-lav mt-1" onClick={onTutorial}>
          ✦ learn to play
        </button>
      </motion.div>
    </div>
  );
}
