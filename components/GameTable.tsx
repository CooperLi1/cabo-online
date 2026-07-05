'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import type { CardInfo, GameState, PlayerState } from '@/lib/types';
import type { Me, Known } from '@/app/page';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { PixelAvatar } from './PixelAvatar';
import { PlayingCard, type CardSize } from './PlayingCard';
import { PixelSprite, EYE, LIGHTNING } from './PixelSprite';

function hashRot(id: string, spread = 8) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % (spread * 2 + 1)) + (spread * 2 + 1)) % (spread * 2 + 1) - spread;
}

export function GameTable({
  state, me, known, drawnKnown, seen, peekedBy, wobbleId, onLeave, onTutorial, muted, onToggleMute,
}: {
  state: GameState;
  me: Me;
  known: Record<string, Known>;
  drawnKnown: Record<string, CardInfo>;
  seen: Set<string>;
  peekedBy: Record<string, number>;
  wobbleId: string | null;
  onLeave: () => void;
  onTutorial: () => void;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const s = getSocket();
  const n = state.players.length;
  const myIdx = Math.max(0, state.players.findIndex((p) => p.pid === me.pid));
  const meP = state.players[myIdx];
  const myTurn = state.phase === 'play' && state.turnPid === me.pid;
  const iAmGiving = state.pendingGive?.fromPid === me.pid;
  const giveTarget = state.pendingGive ? state.players.find((p) => p.pid === state.pendingGive!.toPid) : null;
  const turnPlayer = state.players.find((p) => p.pid === state.turnPid);

  const [blindSel, setBlindSel] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [snapRingKey, setSnapRingKey] = useState(0);
  const [burst, setBurst] = useState(0);
  const lastEpoch = useRef(state.snapEpoch);
  const lastFxSeq = useRef(0);

  // reset blind-swap selection whenever the power context changes
  useEffect(() => { setBlindSel([]); }, [state.stage, state.powerKind, state.turnPid]);

  // discard snap ring on new top card
  useEffect(() => {
    if (state.snapEpoch !== lastEpoch.current) {
      lastEpoch.current = state.snapEpoch;
      setSnapRingKey((k) => k + 1);
    }
  }, [state.snapEpoch]);

  // SNAP! burst on hits
  useEffect(() => {
    for (const fx of state.fxs ?? []) {
      if (fx.seq > lastFxSeq.current) {
        lastFxSeq.current = fx.seq;
        if (fx.type === 'snap-hit') {
          setBurst(Date.now());
          setTimeout(() => setBurst(0), 850);
        }
      }
    }
  }, [state.fxs]);

  // ---------- timer ----------
  const [now, setNow] = useState(() => Date.now());
  const spanRef = useRef<{ deadline: number; span: number } | null>(null);
  useEffect(() => {
    if (state.deadline) {
      if (!spanRef.current || spanRef.current.deadline !== state.deadline) {
        spanRef.current = { deadline: state.deadline, span: Math.max(state.deadline - Date.now(), 1) };
      }
      const t = setInterval(() => setNow(Date.now()), 200);
      return () => clearInterval(t);
    }
    spanRef.current = null;
  }, [state.deadline]);
  const timerFrac = state.deadline && spanRef.current
    ? Math.max(0, Math.min(1, (state.deadline - now) / spanRef.current.span))
    : null;

  // ---------- card faces ----------
  const revealMap = useMemo(() => {
    const m: Record<string, CardInfo> = {};
    if (state.reveal) for (const cards of Object.values(state.reveal)) for (const c of cards) m[c.id] = c;
    return m;
  }, [state.reveal]);

  const faceOf = useCallback((cardId: string): CardInfo | null => {
    if (revealMap[cardId]) return revealMap[cardId];
    const k = known[cardId];
    if (k && (k.until === null || k.until > Date.now())) return k.card;
    return null;
  }, [revealMap, known]);

  // ---------- interactions ----------
  const clickCard = useCallback((cardId: string, ownerPid: string) => {
    const mine = ownerPid === me.pid;
    if (state.phase === 'peek') {
      if (mine && meP.peeksLeft > 0 && !known[cardId]) s.emit('peek', { cardId });
      return;
    }
    if (state.phase !== 'play') return;
    if (iAmGiving) {
      if (mine) s.emit('give', { cardId });
      return;
    }
    if (myTurn && state.stage === 'decide' && mine) {
      s.emit('swapDrawn', { cardId });
      return;
    }
    if (myTurn && state.stage === 'power') {
      const kind = state.powerKind;
      if (kind === 'peek-own' && mine) s.emit('usePower', { cardId });
      else if (kind === 'peek-other' && !mine) s.emit('usePower', { cardId });
      else if (kind === 'blind-swap') {
        setBlindSel((sel) => {
          if (sel.includes(cardId)) return sel.filter((x) => x !== cardId);
          const next = [...sel, cardId];
          const owners = next.map((cid) => state.players.find((p) => p.cards.includes(cid))?.pid);
          const mineSel = next.filter((_, i) => owners[i] === me.pid);
          const theirsSel = next.filter((_, i) => owners[i] !== me.pid);
          if (mineSel.length >= 1 && theirsSel.length >= 1) {
            s.emit('usePower', { aId: mineSel[0], bId: theirsSel[0] });
            return [];
          }
          return next.slice(-2);
        });
      } else if (kind === 'king') {
        if (!state.kingPeeked) s.emit('usePower', { cardId });
        else if (mine) s.emit('usePower', { cardId });
      }
      return;
    }
    // anything else = SNAP attempt
    s.emit('snap', { cardId });
  }, [state, me.pid, meP, myTurn, iAmGiving, known, s]);

  const clickStock = useCallback(() => {
    if (myTurn && state.stage === 'draw' && !state.pendingGive) s.emit('drawStock');
  }, [myTurn, state.stage, state.pendingGive, s]);

  const clickDiscard = useCallback(() => {
    if (!myTurn || state.pendingGive) return;
    if (state.stage === 'draw') s.emit('drawDiscard');
    else if (state.stage === 'decide' && state.drawn?.from === 'stock') s.emit('discardDrawn');
  }, [myTurn, state.stage, state.drawn, state.pendingGive, s]);

  // is this card an "action target" right now? (blinking highlight)
  const isTarget = useCallback((cardId: string, ownerPid: string): boolean => {
    const mine = ownerPid === me.pid;
    if (state.phase === 'peek') return mine && meP.peeksLeft > 0 && !known[cardId];
    if (state.phase !== 'play') return false;
    if (iAmGiving) return mine;
    if (myTurn && state.stage === 'decide') return mine;
    if (myTurn && state.stage === 'power') {
      const kind = state.powerKind;
      if (kind === 'peek-own') return mine;
      if (kind === 'peek-other') return !mine;
      if (kind === 'blind-swap') return true;
      if (kind === 'king') return !state.kingPeeked ? true : mine;
    }
    return false;
  }, [state, me.pid, meP, myTurn, iAmGiving, known]);

  const snapPossible = state.phase === 'play' && !iAmGiving && !(myTurn && (state.stage === 'decide' || state.stage === 'power'));

  // ---------- seats ----------
  const seatPos = (offset: number) => {
    const a = ((90 + (360 * offset) / n) * Math.PI) / 180;
    const sin = Math.sin(a);
    // clamp the bottom seat (mine) so it never collides with the action bar
    const top = sin > 0.9 ? `min(${46 + 36 * sin}%, calc(100% - 235px))` : `${46 + 36 * sin}%`;
    return { left: `${50 + 41 * Math.cos(a)}%`, top, topHalf: sin < 0.25 };
  };

  const otherSize: CardSize = n <= 4 ? 'sm' : 'xs';

  const copyCode = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/?join=${state.code}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const discardTop = state.discard[state.discard.length - 1];
  const caboPlayer = state.players.find((p) => p.pid === state.caboPid);

  // ---------- action hint ----------
  let hint: React.ReactNode = null;
  if (state.phase === 'peek') {
    hint = meP.peeksLeft > 0
      ? <>memorize! tap <b>{meP.peeksLeft}</b> of your cards 👀</>
      : <>remember those! waiting for the others…</>;
  } else if (iAmGiving) {
    hint = <>you snapped {giveTarget?.name}&apos;s card! pick one of yours to give them</>;
  } else if (state.pendingGive) {
    hint = <>{state.players.find((p) => p.pid === state.pendingGive!.fromPid)?.name} is choosing a card to give…</>;
  } else if (myTurn && state.stage === 'draw') {
    hint = <>your turn! tap the <b>deck</b>{state.discard.length > 0 && meP.cards.length > 0 ? <> or the <b>discard</b></> : null} to draw</>;
  } else if (myTurn && state.stage === 'decide') {
    hint = state.drawn?.from === 'discard'
      ? <>tap one of your cards to swap it in</>
      : <>tap one of your cards to <b>swap</b> — or tap the <b>discard pile</b> to toss it</>;
  } else if (myTurn && state.stage === 'power') {
    const kk = state.powerKind;
    if (kk === 'peek-own') hint = <>✨ <b>peek</b>: tap one of your own cards to look at it</>;
    if (kk === 'peek-other') hint = <>✨ <b>spy</b>: tap someone else&apos;s card to look at it</>;
    if (kk === 'blind-swap') hint = <>✨ <b>blind swap</b>: tap one of yours + one of theirs</>;
    if (kk === 'king') hint = !state.kingPeeked
      ? <>👑 <b>king</b>: tap any card to peek at it</>
      : <>👑 now swap it with one of your cards — or skip</>;
  } else if (state.phase === 'play' && turnPlayer) {
    hint = <>{turnPlayer.name} is thinking… <span className="opacity-60">(psst — you can snap matching cards anytime!)</span></>;
  }

  return (
    <LayoutGroup>
      <div className="h-dvh relative overflow-hidden">
        {/* HUD */}
        <div className="hud-top">
          <button className="chip chip-code" onClick={copyCode} title="copy invite link">
            {copied ? 'copied!' : state.code}
          </button>
          <span className="chip">round {state.round}</span>
          <div className="flex-1" />
          <button className="btn btn-small btn-round" onClick={onToggleMute} title="sound">{muted ? '🔇' : '🔊'}</button>
          <button className="btn btn-small btn-round" onClick={onTutorial} title="how to play">?</button>
          <button className="btn btn-small" onClick={onLeave}>leave</button>
        </div>

        {/* cabo banner */}
        <AnimatePresence>
          {caboPlayer && state.phase === 'play' && (
            <motion.div
              className="cabo-banner"
              initial={{ y: -30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              📣 {caboPlayer.name} called CABO — last turns!
            </motion.div>
          )}
        </AnimatePresence>

        <div className="table-felt" />

        {/* piles */}
        <div className="piles">
          {/* stock */}
          <div className="pile" onClick={clickStock} style={{ cursor: myTurn && state.stage === 'draw' ? 'pointer' : 'default' }}>
            <div className="pile-under" style={{ width: 60, height: 84 }} />
            {state.stockCount > 1 && (
              <div style={{ position: 'absolute', top: -3, left: 3 }}>
                <PlayingCard id="stock-under" noLayout size="md" />
              </div>
            )}
            {state.stockCount > 0 && (
              <div style={{ position: 'relative' }} className={myTurn && state.stage === 'draw' ? 'float-bob' : ''}>
                <PlayingCard id="stock-top" noLayout size="md" title="deck" />
              </div>
            )}
            <span className="stock-badge">{state.stockCount}</span>
            <span className="pile-label">deck</span>
          </div>

          {/* discard */}
          <div className="pile" onClick={clickDiscard}
            style={{ cursor: myTurn && (state.stage === 'draw' || state.stage === 'decide') ? 'pointer' : 'default', width: 60, height: 84 }}>
            <div className="pile-under" style={{ width: 60, height: 84 }} />
            <AnimatePresence>
              {state.discard.map((c, i) => (
                <motion.div key={c.id} style={{ position: 'absolute', inset: 0, rotate: hashRot(c.id), zIndex: i }}>
                  <PlayingCard id={c.id} card={c} size="md" />
                </motion.div>
              ))}
            </AnimatePresence>
            {discardTop && state.phase === 'play' && <div key={snapRingKey} className="snap-ring" style={{ zIndex: 9 }} />}
            {burst > 0 && (
              <div className="snap-burst" style={{ position: 'absolute', top: -34, left: '50%', translate: '-50% 0', zIndex: 20, whiteSpace: 'nowrap', fontSize: '1.6rem' }}>
                SNAP!
              </div>
            )}
            <span className="pile-label">discard</span>
          </div>

          {/* drawn card */}
          <AnimatePresence>
            {state.drawn && (
              <motion.div
                key={state.drawn.id}
                initial={{ x: -90, y: 0, scale: 0.7, opacity: 0 }}
                animate={{ x: 0, y: 0, scale: state.turnPid === me.pid ? 1.15 : 1, opacity: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                className="pile"
              >
                <PlayingCard id={state.drawn.id} card={faceOf(state.drawn.id)} size="md" />
                <span className="pile-label">{turnPlayer?.pid === me.pid ? 'your draw' : `${turnPlayer?.name}'s draw`}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* seats */}
        {state.players.map((p, idx) => {
          const offset = ((idx - myIdx) % n + n) % n;
          const pos = seatPos(offset);
          const isMe = p.pid === me.pid;
          const size: CardSize = isMe ? 'md' : otherSize;
          const cols = Math.max(2, Math.ceil(p.cards.length / 2));
          const plate = (
            <div className="seat-plate" style={{ position: 'relative' }}>
              {p.pid === state.caboPid && <span className="cabo-badge">CABO!</span>}
              <span className="avatar-wrap"><PixelAvatar id={p.avatar} size={isMe ? 34 : 28} /></span>
              <span className="seat-name">{p.name}{isMe ? ' ✦' : ''}</span>
              <span className="seat-score" title="total score">{p.score}</span>
              {state.phase === 'peek' && p.peeksLeft === 0 && <span title="ready">✅</span>}
            </div>
          );
          return (
            <div
              key={p.pid}
              className={`seat ${p.isTurn ? 'seat-turn' : ''} ${!p.connected ? 'seat-offline' : ''}`}
              style={{ left: pos.left, top: pos.top }}
            >
              {pos.topHalf && plate}
              <div className="hand-grid" style={{ ['--cols' as string]: cols }}>
                <AnimatePresence>
                  {p.cards.map((cid) => {
                    const face = faceOf(cid);
                    const target = isTarget(cid, p.pid);
                    const clickable = target || (snapPossible && !face);
                    return (
                      <div key={cid} style={{ position: 'relative' }}>
                        <PlayingCard
                          id={cid}
                          card={face}
                          size={size}
                          seen={!face && seen.has(cid) && isMe}
                          selectable={target}
                          selected={blindSel.includes(cid)}
                          wobble={wobbleId === cid}
                          onClick={clickable ? () => clickCard(cid, p.pid) : undefined}
                        />
                        {peekedBy[cid] && (
                          <motion.div
                            initial={{ scale: 0, y: 6 }}
                            animate={{ scale: 1, y: 0 }}
                            style={{ position: 'absolute', top: -12, right: -10, zIndex: 6 }}
                          >
                            <PixelSprite grid={EYE} color="#453950" color2="#fffdfa" size={22} />
                          </motion.div>
                        )}
                      </div>
                    );
                  })}
                </AnimatePresence>
                {p.cards.length === 0 && state.phase === 'play' && (
                  <div className="px-body text-sm opacity-70" style={{ gridColumn: '1 / -1' }}>hand empty! 🎉</div>
                )}
              </div>
              {!pos.topHalf && plate}
            </div>
          );
        })}

        {/* action bar */}
        <div className="action-bar">
          {timerFrac !== null && state.phase !== 'roundEnd' && state.phase !== 'gameOver' && (
            <div className="timer-bar"><div className="timer-fill" style={{ transform: `scaleX(${timerFrac})` }} /></div>
          )}
          {hint && <div className="hint-bubble">{hint}</div>}
          <div className="flex gap-2">
            {myTurn && state.stage === 'draw' && !state.caboPid && !state.pendingGive && (
              <button className="btn btn-primary" onClick={() => s.emit('callCabo')}>
                📣 call CABO!
              </button>
            )}
            {myTurn && state.stage === 'decide' && state.drawn?.from === 'stock' && (
              <button className="btn btn-mint btn-small" onClick={() => s.emit('discardDrawn')}>toss it ➜ discard</button>
            )}
            {myTurn && state.stage === 'power' && (
              <button className="btn btn-small" onClick={() => s.emit('skipPower')}>
                {state.powerKind === 'king' && state.kingPeeked ? 'keep as is' : 'skip power'}
              </button>
            )}
          </div>
        </div>

        {/* round end / game over */}
        {(state.phase === 'roundEnd' || state.phase === 'gameOver') && (
          <RoundEndPanel state={state} me={me} />
        )}
        {state.phase === 'gameOver' && <Confetti />}
      </div>
    </LayoutGroup>
  );
}

function RoundEndPanel({ state, me }: { state: GameState; me: Me }) {
  const s = getSocket();
  const isHost = state.hostPid === me.pid;
  const results = state.roundResults ?? [];
  const sorted = [...results].sort((a, b) => a.pts - b.pts);
  const winner = state.winnerPid ? state.players.find((p) => p.pid === state.winnerPid) : null;
  const playerOf = (pid: string) => state.players.find((p) => p.pid === pid);

  return (
    <div className="overlay" style={{ background: 'rgba(69,57,80,0.25)' }}>
      <motion.div
        className="panel"
        initial={{ y: 40, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        {state.phase === 'gameOver' && winner ? (
          <div className="text-center mb-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1, rotate: [0, -4, 4, 0] }}
              transition={{ type: 'spring', stiffness: 200, damping: 12 }}
              className="inline-block"
            >
              <PixelAvatar id={winner.avatar} size={84} className="float-bob" />
            </motion.div>
            <h2 className="text-3xl font-bold mt-2">👑 {winner.name} wins!</h2>
            <p className="tagline">lowest score takes the crown</p>
          </div>
        ) : (
          <h2 className="text-2xl font-bold text-center mb-4">round {state.round} — reveal!</h2>
        )}

        <div className="flex flex-col gap-2">
          {sorted.map((r) => {
            const p = playerOf(r.pid);
            if (!p) return null;
            const cards = state.reveal?.[r.pid] ?? [];
            return (
              <div key={r.pid} className={`result-row ${state.winnerPid === r.pid ? 'winner' : ''}`}>
                <PixelAvatar id={p.avatar} size={34} />
                <div className="flex flex-col min-w-0" style={{ width: 92 }}>
                  <span className="font-bold truncate text-sm">{p.name}</span>
                  <span className="text-xs opacity-70">
                    {r.isCaller && (r.safe ? '📣 cabo ✓' : '📣 cabo ✗ +10')}
                    {r.luckyReset && ' 🍀 100→50!'}
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap flex-1">
                  {cards.map((c) => (
                    <PlayingCard key={c.id} id={`rv-${c.id}`} noLayout card={c} size="xs" />
                  ))}
                </div>
                <div className="text-right">
                  <div className="font-bold text-lg leading-none">{r.pts > 0 ? `+${r.pts}` : r.pts}</div>
                  <div className="text-xs opacity-70">total {r.total}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-center gap-2 mt-5">
          {isHost ? (
            <button className="btn btn-primary" onClick={() => { sfx.click(); s.emit('start'); }}>
              {state.phase === 'gameOver' ? '↻ play again!' : '➜ next round'}
            </button>
          ) : (
            <div className="hint-bubble">waiting for the host…</div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

const CONFETTI_COLORS = ['#ff8fab', '#b9a6ee', '#7fceac', '#f5c94f', '#7fb8e6', '#fffdfa'];

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 90 }, (_, i) => ({
    x: Math.random() * 100,
    dur: 2.2 + Math.random() * 2.6,
    delay: Math.random() * 1.4,
    sway: (Math.random() - 0.5) * 160,
    c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    r: Math.random() > 0.5,
  })), []);
  return (
    <>
      {pieces.map((p, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            ['--x' as string]: `${p.x}vw`,
            ['--dur' as string]: `${p.dur}s`,
            ['--delay' as string]: `${p.delay}s`,
            ['--sway' as string]: `${p.sway}px`,
            ['--c' as string]: p.c,
            width: p.r ? 8 : 6,
            height: p.r ? 8 : 12,
          }}
        />
      ))}
    </>
  );
}
