'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import type { CardInfo, GameState } from '@/lib/types';
import type { Me, Known } from '@/app/page';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { PixelAvatar } from './PixelAvatar';
import { PlayingCard, type CardSize } from './PlayingCard';
import { PixelSprite, EYE } from './PixelSprite';
import { AudioControl } from './AudioControl';
import { GameSocialControl, GameSocialRibbon, PlayerSocialBubble, useGameSocial } from './GameSocial';

const FLIGHT_CARD_W = 60;
const FLIGHT_CARD_H = 84;

type FlightPoint = {
  x: number;
  y: number;
  scale: number;
};

type SwapFlightCard = {
  id: string;
  card: CardInfo | null;
  from: FlightPoint;
  to: FlightPoint;
  rotateTo: number;
};

type SwapFlight = {
  key: number;
  incoming: SwapFlightCard;
};

function hashRot(id: string, spread = 8) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h % (spread * 2 + 1)) + (spread * 2 + 1)) % (spread * 2 + 1) - spread;
}

function pointFromRect(rect: DOMRect): FlightPoint {
  return {
    x: rect.left + rect.width / 2 - FLIGHT_CARD_W / 2,
    y: rect.top + rect.height / 2 - FLIGHT_CARD_H / 2,
    scale: rect.width / FLIGHT_CARD_W,
  };
}

function cardSelector(cardId: string) {
  return `[data-cardid="${cardId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

export const GameTable = memo(function GameTable({
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
  const [socialOpen, setSocialOpen] = useState(false);
  const [snapRingKey, setSnapRingKey] = useState(0);
  const [burst, setBurst] = useState(0);
  const [localSnap, setLocalSnap] = useState(0); // optimistic burst on MY tap, before the server rules
  const [missBurst, setMissBurst] = useState(0); // server said my snap failed
  const [cardPop, setCardPop] = useState<{ id: string; key: number } | null>(null);
  const [swapFlight, setSwapFlight] = useState<SwapFlight | null>(null);
  const lastEpoch = useRef(state.snapEpoch);
  const lastFxSeq = useRef(0);
  const snapCooldownUntil = useRef(0);
  const cardPopSeq = useRef(0);
  const cardPopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapFlightSeq = useRef(0);
  const swapFlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handSlotMaps = useRef<Map<string, (string | null)[]>>(new Map());
  const handSlotRound = useRef(state.round);
  const lastSlotFxSeq = useRef(0);
  const handSlotsHydrated = useRef(false);
  const pendingSlotSwaps = useRef<Map<string, { pid: string; outId: string; inId: string }>>(new Map());
  const socialMessages = useGameSocial(state.code);

  // reset blind-swap selection whenever the power context changes
  useEffect(() => { setBlindSel([]); }, [state.stage, state.powerKind, state.turnPid]);

  useEffect(() => () => {
    if (cardPopTimer.current) clearTimeout(cardPopTimer.current);
    if (swapFlightTimer.current) clearTimeout(swapFlightTimer.current);
  }, []);

  const popCard = useCallback((cardId: string) => {
    const key = ++cardPopSeq.current;
    setCardPop({ id: cardId, key });
    sfx.pop();
    if (cardPopTimer.current) clearTimeout(cardPopTimer.current);
    cardPopTimer.current = setTimeout(() => {
      setCardPop((cur) => (cur?.key === key ? null : cur));
    }, 240);
  }, []);

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
          setLocalSnap(0);
          setBurst(Date.now());
          setTimeout(() => setBurst(0), 850);
        }
        if (fx.type === 'snap-miss' && fx.pid === me.pid) {
          setLocalSnap(0);
          // match the server's retry cooldown — you may snap again after this
          snapCooldownUntil.current = performance.now() + 500;
          setMissBurst(Date.now());
          setTimeout(() => setMissBurst(0), 750);
        }
      }
    }
  }, [state.fxs, me.pid]);

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

  const startSwapFlight = useCallback((outId: string) => {
    if (!state.drawn) return;
    const drawnDomId = state.drawn.from === 'stock' ? `draw-${state.drawn.id}` : state.drawn.id;
    const incomingEl = document.querySelector<HTMLElement>(cardSelector(drawnDomId));
    const outgoingEl = document.querySelector<HTMLElement>(cardSelector(outId));
    if (!incomingEl || !outgoingEl) return;

    const key = ++swapFlightSeq.current;
    const incomingCard = state.drawn.card
      ?? drawnKnown[state.drawn.id]
      ?? faceOf(state.drawn.id)
      ?? null;
    setSwapFlight({
      key,
      incoming: {
        id: state.drawn.id,
        card: incomingCard,
        from: pointFromRect(incomingEl.getBoundingClientRect()),
        to: pointFromRect(outgoingEl.getBoundingClientRect()),
        rotateTo: 0,
      },
    });
    if (swapFlightTimer.current) clearTimeout(swapFlightTimer.current);
    swapFlightTimer.current = setTimeout(() => {
      setSwapFlight((cur) => (cur?.key === key ? null : cur));
    }, 430);
  }, [state.drawn, drawnKnown, faceOf]);

  const handSlotsByPid = useMemo(() => {
    if (handSlotRound.current !== state.round) {
      handSlotMaps.current.clear();
      handSlotRound.current = state.round;
      lastSlotFxSeq.current = 0;
      handSlotsHydrated.current = false;
    }

    const activePids = new Set(state.players.map((p) => p.pid));
    for (const pid of handSlotMaps.current.keys()) {
      if (!activePids.has(pid)) handSlotMaps.current.delete(pid);
    }

    for (const p of state.players) {
      if (!handSlotMaps.current.has(p.pid)) handSlotMaps.current.set(p.pid, [...p.cards]);
    }

    if (!handSlotsHydrated.current) {
      handSlotsHydrated.current = true;
      lastSlotFxSeq.current = Math.max(lastSlotFxSeq.current, 0, ...(state.fxs ?? []).map((fx) => fx.seq));
    }

    const findSlot = (cardId?: string) => {
      if (!cardId) return null;
      for (const [pid, slots] of handSlotMaps.current) {
        const index = slots.indexOf(cardId);
        if (index >= 0) return { pid, slots, index };
      }
      return null;
    };

    for (const fx of [...(state.fxs ?? [])].sort((a, b) => a.seq - b.seq)) {
      if (fx.seq <= lastSlotFxSeq.current) continue;
      if (fx.type === 'swap' && fx.pid && fx.outId && fx.inId) {
        const slots = handSlotMaps.current.get(fx.pid);
        const index = slots?.indexOf(fx.outId) ?? -1;
        if (slots && index >= 0) slots[index] = fx.inId;
        pendingSlotSwaps.current.delete(fx.inId);
      } else if (fx.type === 'blind-swap' && fx.aId && fx.bId) {
        const a = findSlot(fx.aId);
        const b = findSlot(fx.bId);
        if (a && b) {
          a.slots[a.index] = fx.bId;
          b.slots[b.index] = fx.aId;
        }
      } else if (fx.type === 'snap-hit' && fx.top?.id) {
        const found = findSlot(fx.top.id);
        if (found) found.slots[found.index] = null;
      } else if (fx.type === 'give' && fx.cardId && fx.fromPid && fx.toPid) {
        const from = handSlotMaps.current.get(fx.fromPid);
        const fromIndex = from?.indexOf(fx.cardId) ?? -1;
        if (from && fromIndex >= 0) from[fromIndex] = null;
        const to = handSlotMaps.current.get(fx.toPid);
        if (to) {
          const open = to.findIndex((slot) => slot === null);
          if (open >= 0) to[open] = fx.cardId;
          else to.push(fx.cardId);
        }
      }
      lastSlotFxSeq.current = fx.seq;
    }

    for (const [inId, swap] of pendingSlotSwaps.current) {
      const player = state.players.find((p) => p.pid === swap.pid);
      if (!player) {
        pendingSlotSwaps.current.delete(inId);
        continue;
      }
      const current = new Set(player.cards);
      if (!current.has(swap.inId)) continue;
      const slots = handSlotMaps.current.get(swap.pid);
      if (!slots) {
        pendingSlotSwaps.current.delete(inId);
        continue;
      }
      if (slots.includes(swap.inId)) {
        pendingSlotSwaps.current.delete(inId);
        continue;
      }
      const index = slots.indexOf(swap.outId);
      if (index >= 0) slots[index] = swap.inId;
      pendingSlotSwaps.current.delete(inId);
    }

    const slotsByPid: Record<string, (string | null)[]> = {};
    for (const p of state.players) {
      if (p.cards.length === 0) {
        handSlotMaps.current.set(p.pid, []);
        slotsByPid[p.pid] = [];
        continue;
      }

      const current = new Set(p.cards);
      const slots = (handSlotMaps.current.get(p.pid) ?? []).map((id) =>
        id && current.has(id) ? id : null
      );
      const placed = new Set(slots.filter((id): id is string => !!id));

      for (const id of p.cards) {
        if (placed.has(id)) continue;
        const open = slots.findIndex((slot) => slot === null);
        if (open >= 0) slots[open] = id;
        else slots.push(id);
        placed.add(id);
      }

      handSlotMaps.current.set(p.pid, slots);
      slotsByPid[p.pid] = slots;
    }
    return slotsByPid;
  }, [state.players, state.round, state.fxs]);

  const snapPossible = state.phase === 'play' && !iAmGiving && state.caboPid !== me.pid
    && !(myTurn && (state.stage === 'decide' || state.stage === 'power'));

  // ---------- interactions ----------
  const clickCard = useCallback((cardId: string, ownerPid: string) => {
    const mine = ownerPid === me.pid;
    const caboProtected = !!state.caboPid && ownerPid === state.caboPid && ownerPid !== me.pid;
    const snapNow = (allowDuringPeekPower = false) => {
      if ((!snapPossible && !allowDuringPeekPower) || state.snapLocked || performance.now() < snapCooldownUntil.current) return false;
      popCard(cardId);
      snapCooldownUntil.current = performance.now() + 120;
      // feel-instant: show the burst locally right away; the server still
      // decides the real race and corrects with a penalty if we were wrong/late
      setLocalSnap(Date.now());
      setTimeout(() => setLocalSnap(0), 600);
      s.emit('snap', { cardId, reaction: Math.round(performance.now() - epochSeenAt.current) });
      return true;
    };
    if (state.phase === 'peek') {
      if (mine && meP.peeksLeft > 0 && !known[cardId]) {
        popCard(cardId);
        s.emit('peek', { cardId });
      }
      return;
    }
    if (state.phase !== 'play') return;
    if (iAmGiving) {
      if (mine) {
        popCard(cardId);
        s.emit('give', { cardId });
      }
      return;
    }
    if (myTurn && state.stage === 'decide' && mine) {
      popCard(cardId);
      if (state.drawn) {
        startSwapFlight(cardId);
        pendingSlotSwaps.current.set(state.drawn.id, { pid: me.pid, outId: cardId, inId: state.drawn.id });
      }
      s.emit('swapDrawn', { cardId });
      return;
    }
    if (myTurn && state.stage === 'power') {
      const kind = state.powerKind;
      if (kind === 'peek-own' && mine) {
        if (known[cardId] && known[cardId].until !== null && snapNow(true)) return;
        popCard(cardId);
        s.emit('usePower', { cardId });
      }
      else if (kind === 'peek-other' && !mine && !caboProtected) {
        popCard(cardId);
        s.emit('usePower', { cardId });
      }
      else if (kind === 'blind-swap') {
        if (!mine && caboProtected) return;
        popCard(cardId);
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
        if (!state.qPeeked && !mine && !caboProtected) {
          popCard(cardId);
          s.emit('usePower', { cardId });
        }
        else if (mine) {
          popCard(cardId);
          s.emit('usePower', { cardId });
        }
      }
      return;
    }
    // anything else = SNAP attempt — send true reaction time since the
    // snappable card appeared on this screen
    snapNow();
  }, [state, me.pid, meP, myTurn, iAmGiving, known, snapPossible, s, popCard, startSwapFlight]);

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
      if (kind === 'peek-swap') return !state.qPeeked ? !mine && !caboProtected : mine;
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
      ? `min(${pct}%, calc(100% - var(--seat-bottom-gap, 245px)))` // my seat: clear of the action bar
      : `clamp(var(--seat-top-min, 128px), ${pct}%, calc(100% - var(--seat-bottom-gap, 245px)))`;
    const x = 50 + 41 * Math.cos(a);
    const socialAlign: 'left' | 'center' | 'right' = x < 25 ? 'left' : x > 75 ? 'right' : 'center';
    return { left: `clamp(62px, ${x}%, calc(100% - 62px))`, top, topHalf: sin < 0.25, socialAlign };
  };

  const otherSize: CardSize = n <= 4 ? 'sm' : 'xs';

  const copyCode = () => {
    navigator.clipboard?.writeText(`${window.location.origin}/?join=${state.code}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const discardTop = state.discard[state.discard.length - 1];
  const caboPlayer = state.players.find((p) => p.pid === state.caboPid);

  // framer-motion re-measures every layout card on each render; keying the
  // measurement to the actual card arrangement skips that work for unrelated
  // updates (timers, toasts, hint changes) — the big animation-lag fix
  const layoutKey = useMemo(
    () => state.players.map((p) => p.cards.join(',')).join('|') + '#' + state.discard.map((c) => c.id).join(','),
    [state.players, state.discard],
  );

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
      ? <>👸 <b>queen</b>: tap someone else&apos;s card to peek at it</>
      : <>👸 now swap it with one of your cards — or keep yours</>;
  } else if (state.phase === 'play' && turnPlayer && turnPlayer.pid !== me.pid) {
    hint = <>{turnPlayer.name} is thinking… <span className="opacity-60">psst — you can snap matching cards anytime!</span></>;
  }

  return (
    <LayoutGroup>
      <div className="h-dvh relative overflow-hidden" data-crowd={n >= 7 ? 'yes' : undefined}>
        {/* HUD */}
        <div className="hud-top">
          <button className="chip chip-code" onClick={copyCode} title="copy invite link">
            {copied ? 'copied!' : state.code}
          </button>
          <div className="flex-1" />
          <GameSocialControl open={socialOpen} onOpenChange={setSocialOpen} />
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
          <div className="pile pile-slot" onClick={clickStock} style={{ cursor: myTurn && state.stage === 'draw' ? 'pointer' : 'default' }}>
            <div className="pile-under pile-slot" />
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
          <div className="pile pile-slot" onClick={clickDiscard}
            style={{ cursor: myTurn && (state.stage === 'draw' || state.stage === 'decide') ? 'pointer' : 'default' }}>
            <div className="pile-under pile-slot" />
            {state.discard.map((c, i) => (
              <div key={c.id} style={{ position: 'absolute', inset: 0, rotate: `${hashRot(c.id)}deg`, zIndex: i }}>
                <PlayingCard id={c.id} card={c} size="md" layoutKey={layoutKey} />
              </div>
            ))}
            {discardTop && state.phase === 'play' && !state.snapLocked && <div key={snapRingKey} className="snap-ring" style={{ zIndex: 9 }} />}
            {burst > 0 ? (
              <div className="snap-burst" style={{ position: 'absolute', top: -34, left: '50%', translate: '-50% 0', zIndex: 20, whiteSpace: 'nowrap', fontSize: '1.6rem' }}>
                SNAP!
              </div>
            ) : missBurst > 0 ? (
              <div className="snap-burst snap-burst-miss" style={{ position: 'absolute', top: -34, left: '50%', translate: '-50% 0', zIndex: 20, whiteSpace: 'nowrap', fontSize: '1.3rem' }}>
                nope!
              </div>
            ) : localSnap > 0 ? (
              <div className="snap-burst snap-burst-local" style={{ position: 'absolute', top: -34, left: '50%', translate: '-50% 0', zIndex: 20, whiteSpace: 'nowrap', fontSize: '1.3rem' }}>
                SNAP?
              </div>
            ) : null}
            <span className="pile-label">discard</span>
          </div>

          {/* draw slot — always present; the card layout-animates in and out */}
          <div className="pile pile-slot">
            <div className="pile-under pile-slot" />
            {state.drawn && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 2, scale: myTurn ? '1.12' : '1' }}>
                <PlayingCard
                  id={state.drawn.from === 'stock' ? `draw-${state.drawn.id}` : state.drawn.id}
                  noLayout={state.drawn.from === 'stock'}
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
          const slots = handSlotsByPid[p.pid] ?? p.cards;
          const cols = Math.max(2, Math.ceil(Math.max(slots.length, p.cards.length) / 2));
          const plate = (
            <div style={{ position: 'relative' }}>
              <PlayerSocialBubble
                message={socialMessages[p.pid]}
                side={pos.topHalf ? 'above' : 'below'}
                align={pos.socialAlign}
              />
              {p.pid === state.caboPid && <span className="cabo-badge">CABO!</span>}
              <div className="seat-plate">
                <span className="avatar-wrap"><PixelAvatar id={p.avatar} size={isMe ? 34 : 28} /></span>
                <span className="seat-name">{p.isBot ? '🤖' : ''}{p.name}</span>
                {isMe && <span aria-hidden>✦</span>}
                {state.phase === 'peek' && p.peeksLeft === 0 && <span title="ready">✅</span>}
              </div>
            </div>
          );
          return (
            <div
              key={p.pid}
              className={`seat ${p.isTurn ? 'seat-turn' : ''} ${!p.connected ? 'seat-offline' : ''} ${socialMessages[p.pid] ? 'seat-social-active' : ''}`}
              style={{ left: pos.left, top: pos.top }}
            >
              {pos.topHalf && plate}
              <div className="hand-grid" style={{ ['--cols' as string]: cols }}>
                {slots.map((cid, slotIdx) => {
                    if (!cid) {
                      return (
                        <div
                          key={`empty-${slotIdx}`}
                          className={`hand-slot-empty hand-slot-${size}`}
                          aria-hidden="true"
                        />
                      );
                    }
                    const face = faceOf(cid);
                    const target = isTarget(cid, p.pid);
                    const caboProtected = !!state.caboPid && p.pid === state.caboPid && p.pid !== me.pid;
                    // temporarily-revealed cards (your 7/8/9/10/Q peeks, public
                    // missnap flips) are fair game to snap while they show
                    const tempReveal = !!known[cid] && known[cid].until !== null;
                    const clickable = target || (snapPossible && !caboProtected && (!face || tempReveal));
                    return (
                      <div key={cid} style={{ position: 'relative' }}>
                        <PlayingCard
                          id={cid}
                          card={face}
                          size={size}
                          layoutKey={layoutKey}
                          seen={!face && seen.has(cid) && isMe}
                          selectable={target}
                          selected={blindSel.includes(cid)}
                          wobble={wobbleId === cid}
                          popKey={cardPop?.id === cid ? cardPop.key : 0}
                          onClick={clickable && target ? () => clickCard(cid, p.pid) : undefined}
                          onSnapDown={clickable && !target ? () => clickCard(cid, p.pid) : undefined}
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
          {state.phase !== 'gameOver' && <TurnTimerBar deadline={state.deadline} />}
          <GameSocialRibbon open={socialOpen} onOpenChange={setSocialOpen} />
          {!socialOpen && (
            <>
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
            </>
          )}
        </div>

        {/* game over */}
        {state.phase === 'gameOver' && <GameOverPanel state={state} me={me} onLeave={onLeave} />}
        {state.phase === 'gameOver' && <Confetti />}
        <AnimatePresence>
          {swapFlight && <SwapFlightLayer key={swapFlight.key} flight={swapFlight} />}
        </AnimatePresence>
        {showValues && <ValuesPanel onClose={() => setShowValues(false)} />}
      </div>
    </LayoutGroup>
  );
});

// isolated so the 5-per-second countdown tick doesn't re-render the table
function TurnTimerBar({ deadline }: { deadline: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  const spanRef = useRef<{ deadline: number; span: number } | null>(null);
  useEffect(() => {
    if (deadline) {
      if (!spanRef.current || spanRef.current.deadline !== deadline) {
        spanRef.current = { deadline, span: Math.max(deadline - Date.now(), 1) };
      }
      const t = setInterval(() => setNow(Date.now()), 200);
      return () => clearInterval(t);
    }
    spanRef.current = null;
  }, [deadline]);
  if (!deadline || !spanRef.current) return null;
  const frac = Math.max(0, Math.min(1, (deadline - now) / spanRef.current.span));
  return (
    <div className="timer-bar"><div className="timer-fill" style={{ transform: `scaleX(${frac})` }} /></div>
  );
}

function SwapFlightLayer({ flight }: { flight: SwapFlight }) {
  const renderCard = (kind: 'incoming' | 'outgoing', item: SwapFlightCard) => {
    const lift = Math.min(item.from.y, item.to.y) - 28;
    const rotateMid = kind === 'incoming' ? 3 : -4;
    return (
      <motion.div
        key={`${kind}-${item.id}`}
        className="swap-flight-card"
        style={{ width: FLIGHT_CARD_W, height: FLIGHT_CARD_H }}
        initial={{
          x: item.from.x,
          y: item.from.y,
          scale: item.from.scale,
          rotate: 0,
          opacity: 1,
        }}
        animate={{
          x: [item.from.x, item.to.x],
          y: [item.from.y, lift, item.to.y],
          scale: [item.from.scale, 1.14, item.to.scale],
          rotate: [0, rotateMid, item.rotateTo],
          opacity: [1, 1, 0],
        }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.36, ease: [0.25, 0.8, 0.2, 1], times: [0, 0.48, 1] }}
      >
        <PlayingCard id={`flight-${kind}-${flight.key}-${item.id}`} noLayout card={item.card} size="md" />
      </motion.div>
    );
  };

  return (
    <div className="swap-flight-layer" aria-hidden="true">
      {renderCard('incoming', flight.incoming)}
    </div>
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
          <div className="result-row"><b className="px-body text-lg">Q</b>&nbsp; peek someone ELSE&apos;s card, then swap it with yours if you like</div>
        </div>
        <h3 className="font-bold mb-2">winning</h3>
        <div className="flex flex-col gap-2 text-sm leading-snug">
          <div className="result-row">📣 after a CABO call, lowest total wins</div>
          <div className="result-row">🤝 tied? the caller loses the tie — then more cards wins — then it&apos;s a true tie</div>
          <div className="result-row">⚡ snap away ALL your cards → instant win</div>
          <div className="result-row">💥 kamikaze: exactly 2 black kings + 2 face cards → instant win</div>
          <div className="result-row">🐌 wrong snap → penalty card, but you can try again — once someone gets it, the pile locks</div>
        </div>
      </div>
    </div>
  );
}

function GameOverPanel({ state, me, onLeave }: { state: GameState; me: Me; onLeave: () => void }) {
  const s = getSocket();
  const [shared, setShared] = useState(false);
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

  const shareResults = () => {
    const lines = sorted.map((r, i) => {
      const p = playerOf(r.pid);
      if (!p) return '';
      const medal = winnerPids.includes(r.pid) ? '👑' : ['🥈', '🥉'][i - winnerPids.length] ?? '🃏';
      const tags = [r.isCaller && '📣', r.kamikaze && '💥', r.emptied && '⚡'].filter(Boolean).join(' ');
      const pts = `${r.handSum} ${Math.abs(r.handSum) === 1 ? 'point' : 'points'}`;
      return `${medal} ${p.name} — ${pts}${tags ? ` ${tags}` : ''}`;
    }).filter(Boolean);
    const text = `cabo! 🎴 game results\n${lines.join('\n')}\n\nplay at ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => { /* user backed out */ });
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
      setShared(true);
      setTimeout(() => setShared(false), 1600);
    }
  };

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
                  <div className="text-xs opacity-70">{Math.abs(r.handSum) === 1 ? 'point' : 'points'}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-center items-center gap-2 mt-5 flex-wrap">
          {isHost ? (
            <button className="btn btn-primary" onClick={() => { sfx.click(); s.emit('start'); }}>
              ↻ play again!
            </button>
          ) : (
            <div className="hint-bubble">waiting for the host…</div>
          )}
          <button className="btn" onClick={() => { sfx.click(); shareResults(); }}>
            {shared ? 'copied!' : '📤 share'}
          </button>
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
