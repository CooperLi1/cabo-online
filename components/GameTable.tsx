'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import type { CardInfo, GameState } from '@/lib/types';
import type { Me, Known } from '@/app/page';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { PixelAvatar } from './PixelAvatar';
import { PlayingCard, type CardSize } from './PlayingCard';
import { PixelSprite, EYE } from './PixelSprite';
import { AudioControl } from './AudioControl';

function hashRot(id: string, spread = 8) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % (spread * 2 + 1)) + (spread * 2 + 1)) % (spread * 2 + 1) - spread;
}

export function GameTable({
  state, me, known, drawnKnown, seen, peekedBy, wobbleId, onLeave, onTutorial,
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
  const [showValues, setShowValues] = useState(false);
  const [snapRingKey, setSnapRingKey] = useState(0);
  const [burst, setBurst] = useState(0);
  const lastEpoch = useRef(state.snapEpoch);
  const lastFxSeq = useRef(0);
  const snapCooldownUntil = useRef(0);

  // reset blind-swap selection whenever the power context changes
  useEffect(() => { setBlindSel([]); }, [state.stage, state.powerKind, state.turnPid]);

  // discard snap ring on new top card + timestamp for true reaction-speed snaps
  const epochSeenAt = useRef(performance.now());
  useEffect(() => {
    if (state.snapEpoch !== lastEpoch.current) {
      lastEpoch.current = state.snapEpoch;
      epochSeenAt.current = performance.now();
      if (state.snapLocked) snapCooldownUntil.current = performance.now() + 900;
      setSnapRingKey((k) => k + 1);
    }
  }, [state.snapEpoch, state.snapLocked]);

  // SNAP! burst on hits
  useEffect(() => {
    for (const fx of state.fxs ?? []) {
      if (fx.seq > lastFxSeq.current) {
        lastFxSeq.current = fx.seq;
        if (fx.type === 'snap-hit') {
          if (fx.pid === me.pid) snapCooldownUntil.current = performance.now() + 900;
          setBurst(Date.now());
          setTimeout(() => setBurst(0), 850);
        }
      }
    }
  }, [state.fxs, me.pid]);

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

  const snapPossible = state.phase === 'play' && !iAmGiving && !(myTurn && (state.stage === 'decide' || state.stage === 'power'));

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
      } else if (kind === 'peek-swap') {
        if (!state.qPeeked) s.emit('usePower', { cardId });
        else if (mine) s.emit('usePower', { cardId });
      }
      return;
    }
    // anything else = SNAP attempt — send true reaction time since the
    // snappable card appeared on this screen
    if (!snapPossible || state.snapLocked || performance.now() < snapCooldownUntil.current) return;
    snapCooldownUntil.current = performance.now() + 120;
    s.emit('snap', { cardId, reaction: Math.round(performance.now() - epochSeenAt.current) });
  }, [state, me.pid, meP, myTurn, iAmGiving, known, snapPossible, s]);

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
    const caboProtected = !!state.caboPid && ownerPid === state.caboPid && ownerPid !== me.pid;
    if (state.phase === 'peek') return mine && meP.peeksLeft > 0 && !known[cardId];
    if (state.phase !== 'play') return false;
    if (iAmGiving) return mine;
    if (myTurn && state.stage === 'decide') return mine;
    if (myTurn && state.stage === 'power') {
      const kind = state.powerKind;
      if (kind === 'peek-own') return mine;
      if (kind === 'peek-other') return !mine && !caboProtected;
      if (kind === 'blind-swap') return mine || !caboProtected;
      if (kind === 'peek-swap') return !state.qPeeked ? !caboProtected : mine;
    }
    return false;
  }, [state, me.pid, meP, myTurn, iAmGiving, known]);

  // ---------- seats ----------
  const seatPos = (offset: number) => {
    const a = ((90 + (360 * offset) / n) * Math.PI) / 180;
    const sin = Math.sin(a);
    // clamp seats so the top plate and the bottom hand always stay on screen
    const pct = 46 + 34 * sin;
    const top = sin > 0.9
      ? `min(${pct}%, calc(100% - 245px))` // my seat: clear of the action bar
      : `clamp(128px, ${pct}%, calc(100% - 245px))`;
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
    if (kk === 'peek-swap') hint = !state.qPeeked
      ? <>👸 <b>queen</b>: tap any card to peek at it</>
      : <>👸 now swap it with one of your cards — or keep yours</>;
  } else if (state.phase === 'play' && turnPlayer && turnPlayer.pid !== me.pid) {
    hint = <>{turnPlayer.name} is thinking… <span className="opacity-60">psst — you can snap matching cards anytime!</span></>;
  }

  return (
    <LayoutGroup>
      <div className="h-dvh relative overflow-hidden">
        {/* HUD */}
        <div className="hud-top">
          <button className="chip chip-code" onClick={copyCode} title="copy invite link">
            {copied ? 'copied!' : state.code}
          </button>
          <div className="flex-1" />
          <button className="btn btn-small" onClick={() => setShowValues(true)} title="card values">values</button>
          <AudioControl />
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
            {state.discard.map((c, i) => (
              <div key={c.id} style={{ position: 'absolute', inset: 0, rotate: `${hashRot(c.id)}deg`, zIndex: i }}>
                <PlayingCard id={c.id} card={c} size="md" />
              </div>
            ))}
            {discardTop && state.phase === 'play' && !state.snapLocked && <div key={snapRingKey} className="snap-ring" style={{ zIndex: 9 }} />}
            {burst > 0 && (
              <div className="snap-burst" style={{ position: 'absolute', top: -34, left: '50%', translate: '-50% 0', zIndex: 20, whiteSpace: 'nowrap', fontSize: '1.6rem' }}>
                SNAP!
              </div>
            )}
            <span className="pile-label">discard</span>
          </div>

          {/* draw slot — always present; the card layout-animates in and out */}
          <div className="pile" style={{ width: 60, height: 84 }}>
            <div className="pile-under" style={{ width: 60, height: 84 }} />
            {state.drawn && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 2, scale: myTurn ? '1.12' : '1' }}>
                <PlayingCard
                  id={state.drawn.id}
                  card={
                    state.drawn.card // taken from the discard — public
                    ?? (state.turnPid === me.pid
                      ? drawnKnown[state.drawn.id] ?? faceOf(state.drawn.id) ?? null
                      : null) // other players' stock draws stay hidden
                  }
                  size="md"
                />
              </div>
            )}
            <span className="pile-label">
              {state.drawn
                ? (turnPlayer?.pid === me.pid ? 'your draw!' : `${turnPlayer?.name}'s draw`)
                : 'draw'}
            </span>
          </div>
        </div>

        {/* seats */}
        {state.players.map((p, idx) => {
          const offset = ((idx - myIdx) % n + n) % n;
          const pos = seatPos(offset);
          const isMe = p.pid === me.pid;
          const size: CardSize = isMe ? 'md' : otherSize;
          const cols = Math.max(2, Math.ceil(p.cards.length / 2));
          const plate = (
            <div style={{ position: 'relative' }}>
              {p.pid === state.caboPid && <span className="cabo-badge">CABO!</span>}
              <div className="seat-plate">
                <span className="avatar-wrap"><PixelAvatar id={p.avatar} size={isMe ? 34 : 28} /></span>
                <span className="seat-name">{p.isBot ? '🤖' : ''}{p.name}{isMe ? ' ✦' : ''}</span>
                {state.phase === 'peek' && p.peeksLeft === 0 && <span title="ready">✅</span>}
              </div>
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
                {p.cards.map((cid) => {
                    const face = faceOf(cid);
                    const target = isTarget(cid, p.pid);
                    const caboProtected = !!state.caboPid && p.pid === state.caboPid && p.pid !== me.pid;
                    const clickable = target || (snapPossible && !face && !caboProtected);
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
          {timerFrac !== null && state.phase !== 'gameOver' && (
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
                {state.powerKind === 'peek-swap' && state.qPeeked ? 'keep mine' : 'skip power'}
              </button>
            )}
          </div>
        </div>

        {/* game over */}
        {state.phase === 'gameOver' && <GameOverPanel state={state} me={me} onLeave={onLeave} />}
        {state.phase === 'gameOver' && <Confetti />}
        {showValues && <ValuesPanel onClose={() => setShowValues(false)} />}
      </div>
    </LayoutGroup>
  );
}

const VALUE_CHART: { card: CardInfo; value: string; note: string }[] = [
  { card: { id: 'v-x', r: 'X', s: '★' }, value: '0', note: 'joker' },
  { card: { id: 'v-a', r: 'A', s: '♣' }, value: '1', note: 'ace' },
  { card: { id: 'v-7', r: '7', s: '♦' }, value: '2–10', note: 'face value' },
  { card: { id: 'v-j', r: 'J', s: '♠' }, value: '11', note: 'jack' },
  { card: { id: 'v-q', r: 'Q', s: '♥' }, value: '12', note: 'queen' },
  { card: { id: 'v-rk', r: 'K', s: '♥' }, value: '−1', note: 'red king' },
  { card: { id: 'v-bk', r: 'K', s: '♠' }, value: '25', note: 'black king' },
];

export function ValuesPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 470 }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">card values</h2>
          <button className="btn btn-small btn-round" onClick={onClose}>✕</button>
        </div>
        <div className="grid grid-cols-7 gap-1 justify-items-center mb-5">
          {VALUE_CHART.map(({ card, value, note }) => (
            <div key={card.id} className="flex flex-col items-center gap-1">
              <PlayingCard id={card.id} noLayout card={card} size="sm" />
              <span className="px-body text-xl leading-none mt-1"
                style={{ color: card.id === 'v-bk' || card.id === 'v-rk' ? 'var(--pink-deep)' : undefined }}>
                {value}
              </span>
              <span className="text-[0.62rem] opacity-60 leading-none text-center">{note}</span>
            </div>
          ))}
        </div>
        <h3 className="font-bold mb-2">powers <span className="opacity-60 text-sm">(toss the drawn card onto the pile)</span></h3>
        <div className="flex flex-col gap-2 text-sm leading-snug mb-4">
          <div className="result-row"><b className="px-body text-lg">7·8</b>&nbsp; peek at one of YOUR cards</div>
          <div className="result-row"><b className="px-body text-lg">9·10</b>&nbsp; spy on someone ELSE&apos;s card</div>
          <div className="result-row"><b className="px-body text-lg">J</b>&nbsp; blind swap — one of yours ↔ one of theirs</div>
          <div className="result-row"><b className="px-body text-lg">Q</b>&nbsp; peek ANY card, then swap it with yours if you like</div>
        </div>
        <h3 className="font-bold mb-2">winning</h3>
        <div className="flex flex-col gap-2 text-sm leading-snug">
          <div className="result-row">📣 after a CABO call, lowest total wins</div>
          <div className="result-row">🤝 tied? the caller loses the tie — then more cards wins — then it&apos;s a true tie</div>
          <div className="result-row">⚡ snap away ALL your cards → instant win</div>
          <div className="result-row">💥 kamikaze: exactly 2 black kings + 2 face cards → instant win</div>
          <div className="result-row">🐌 one snap per discard — wrong card or too late → penalty card</div>
        </div>
      </div>
    </div>
  );
}

function GameOverPanel({ state, me, onLeave }: { state: GameState; me: Me; onLeave: () => void }) {
  const s = getSocket();
  const isHost = state.hostPid === me.pid;
  const results = state.roundResults ?? [];
  const winnerPids = state.winnerPids?.length ? state.winnerPids : (state.winnerPid ? [state.winnerPid] : []);
  const isTie = winnerPids.length > 1;
  const sorted = [...results].sort((a, b) => {
    const aw = winnerPids.includes(a.pid) ? 0 : 1;
    const bw = winnerPids.includes(b.pid) ? 0 : 1;
    return (aw - bw) || (a.handSum - b.handSum);
  });
  const winner = state.winnerPid ? state.players.find((p) => p.pid === state.winnerPid) : null;
  const winRow = results.find((r) => r.pid === state.winnerPid);
  const playerOf = (pid: string) => state.players.find((p) => p.pid === pid);
  const winReason = winRow?.kamikaze ? '💥 KAMIKAZE — 2 black kings + 2 faces!'
    : winRow?.emptied ? '⚡ snapped away every card!'
      : isTie ? 'same total, same card count — shared crown!'
        : winRow?.caboWon ? '📣 called cabo and stuck the landing'
          : 'lowest hand takes it';

  return (
    <div className="overlay" style={{ background: 'rgba(69,57,80,0.25)' }}>
      <motion.div
        className="panel"
        initial={{ y: 40, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        {winner && (
          <div className="text-center mb-4">
            <motion.div
              initial={{ scale: 0, rotate: -8 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 12 }}
              className="inline-flex gap-3"
            >
              {winnerPids.map((pid) => {
                const w = playerOf(pid);
                return w ? <PixelAvatar key={pid} id={w.avatar} size={84} className="float-bob" /> : null;
              })}
            </motion.div>
            <h2 className="text-3xl font-bold mt-2">
              👑 {isTie
                ? `it's a tie — ${winnerPids.map((pid) => playerOf(pid)?.name).filter(Boolean).join(' & ')}!`
                : `${winner.name} wins!`}
            </h2>
            <p className="tagline">{winReason}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {sorted.map((r) => {
            const p = playerOf(r.pid);
            if (!p) return null;
            const cards = state.reveal?.[r.pid] ?? [];
            return (
              <div key={r.pid} className={`result-row ${winnerPids.includes(r.pid) ? 'winner' : ''}`}>
                <PixelAvatar id={p.avatar} size={34} />
                <div className="flex flex-col min-w-0" style={{ width: 92 }}>
                  <span className="font-bold truncate text-sm">{p.name}</span>
                  <span className="text-xs opacity-70">
                    {r.isCaller && '📣 cabo'}
                    {r.kamikaze && ' 💥'}
                    {r.emptied && ' ⚡'}
                  </span>
                </div>
                <div className="flex gap-1 flex-wrap flex-1">
                  {cards.length === 0
                    ? <span className="px-body opacity-70">no cards!</span>
                    : cards.map((c) => (
                      <PlayingCard key={c.id} id={`rv-${c.id}`} noLayout card={c} size="xs" />
                    ))}
                </div>
                <div className="text-right">
                  <div className="px-body text-2xl leading-none">{r.handSum}</div>
                  <div className="text-xs opacity-70">points</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-center items-center gap-2 mt-5">
          {isHost ? (
            <button className="btn btn-primary" onClick={() => { sfx.click(); s.emit('start'); }}>
              ↻ play again!
            </button>
          ) : (
            <div className="hint-bubble">waiting for the host…</div>
          )}
          <button className="btn" onClick={() => { sfx.click(); onLeave(); }}>leave</button>
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
