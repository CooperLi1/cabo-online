'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { GameState } from '@/lib/types';
import type { Me } from '@/app/page';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { PixelAvatar } from './PixelAvatar';
import { PixelClouds } from './Home';
import { AudioControl } from './AudioControl';

export function Lobby({
  state,
  me,
  onLeave,
  onTutorial,
}: {
  state: GameState;
  me: Me;
  onLeave: () => void;
  onTutorial: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = state.hostPid === me.pid;
  const turnSeconds = Math.round(state.turnMs / 1000);
  const [turnDraft, setTurnDraft] = useState(String(turnSeconds));
  const [editingTurn, setEditingTurn] = useState(false);

  useEffect(() => {
    if (!editingTurn) setTurnDraft(String(turnSeconds));
  }, [editingTurn, turnSeconds]);

  const setTurnSeconds = (seconds: number) => {
    const clamped = Math.min(Math.max(Math.round(seconds), 3), 120);
    getSocket().emit('setTurnMs', { turnMs: clamped * 1000 });
    return clamped;
  };

  const commitTurnDraft = () => {
    const parsed = parseInt(turnDraft, 10);
    if (Number.isFinite(parsed)) {
      setTurnDraft(String(setTurnSeconds(parsed)));
    } else {
      setTurnDraft(String(turnSeconds));
    }
    setEditingTurn(false);
  };

  const copy = () => {
    const url = `${window.location.origin}/?join=${state.code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    sfx.click();
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-dvh flex flex-col items-center justify-center gap-6 px-4 relative overflow-hidden">
      <PixelClouds />
      <div style={{ position: 'fixed', top: 12, right: 14, zIndex: 30 }}><AudioControl /></div>

      <motion.div initial={{ y: -18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="text-center">
        <p className="tagline mb-2">share this code with your friends</p>
        <button
          className="chip chip-code text-4xl px-8 py-3 font-bold"
          onClick={copy}
          title="click to copy invite link"
        >
          {state.code}
        </button>
        <div className="tagline mt-2 text-sm h-5">{copied ? '✦ invite link copied!' : 'tap to copy the invite link'}</div>
      </motion.div>

      <div className="flex flex-wrap gap-3 justify-center max-w-xl">
        <AnimatePresence>
          {state.players.map((p) => (
            <motion.div
              key={p.pid}
              layout
              initial={{ scale: 0.4, opacity: 0, y: 16 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="lobby-chip"
              style={{ position: 'relative' }}
            >
              {p.isBot && isHost && (
                <button
                  className="bot-remove"
                  title="remove bot"
                  onClick={() => { sfx.click(); getSocket().emit('removeBot', { pid: p.pid }); }}
                >
                  ✕
                </button>
              )}
              <div className="float-bob" style={{ animationDelay: `${(p.pid.charCodeAt(0) % 5) * 0.2}s` }}>
                <PixelAvatar id={p.avatar} size={52} />
              </div>
              <span className="nm">{p.isBot ? '🤖' : ''}{p.name}</span>
              {p.pid === me.pid && <span className="text-[0.65rem] font-bold text-[var(--lav-deep)]">✦ you</span>}
              {p.pid === state.hostPid && <span className="text-[0.65rem] font-bold text-[var(--butter-deep)]">★ host</span>}
              {p.isBot && <span className="text-[0.65rem] font-bold text-[var(--mint-dark)]">{p.botLevel}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex flex-col items-center gap-3">
        <div className="turn-slider">
          <span className="tagline text-sm">turn timer:</span>
          {isHost ? (
            <>
              <input
                type="range" min={3} max={120} step={1}
                value={turnSeconds}
                onChange={(e) => setTurnSeconds(parseInt(e.target.value, 10))}
                onPointerUp={() => sfx.click()}
              />
              <input
                type="number" min={3} max={120} step={1} inputMode="numeric"
                className="input turn-num"
                value={editingTurn ? turnDraft : String(turnSeconds)}
                onFocus={() => {
                  setEditingTurn(true);
                  setTurnDraft(String(turnSeconds));
                }}
                onChange={(e) => setTurnDraft(e.target.value)}
                onBlur={commitTurnDraft}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') {
                    setTurnDraft(String(turnSeconds));
                    e.currentTarget.blur();
                  }
                }}
              />
              <span className="tagline text-sm">s</span>
            </>
          ) : (
            <span className="chip" style={{ padding: '2px 10px' }}>{Math.round(state.turnMs / 1000)}s</span>
          )}
        </div>
        {isHost && state.players.length < 12 && (
          <div className="flex items-center gap-2">
            <span className="tagline text-sm">add a bot:</span>
            {(['easy', 'medium', 'expert'] as const).map((lvl) => (
              <button
                key={lvl}
                className="btn btn-small"
                onClick={() => { sfx.click(); getSocket().emit('addBot', { level: lvl }); }}
              >
                🤖 {lvl}
              </button>
            ))}
          </div>
        )}
        {isHost ? (
          <button
            className="btn btn-primary text-lg"
            disabled={state.players.length < 2}
            onClick={() => { sfx.click(); getSocket().emit('start'); }}
          >
            {state.players.length < 2 ? 'waiting for players…' : `deal the cards! ✦ ${state.players.length} playing`}
          </button>
        ) : (
          <div className="hint-bubble">waiting for the host to start…</div>
        )}
        <div className="flex gap-2">
          <button className="btn btn-small btn-lav" onClick={onTutorial}>✦ learn to play</button>
          <button className="btn btn-small" onClick={onLeave}>leave</button>
        </div>
      </div>
    </div>
  );
}
