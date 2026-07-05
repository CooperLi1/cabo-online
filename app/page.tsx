'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CardInfo, GameState, Fx, PrivateMsg } from '@/lib/types';
import { getSocket } from '@/lib/socket';
import { sfx } from '@/lib/sounds';
import { startMusic } from '@/lib/music';
import { Home } from '@/components/Home';
import { Lobby } from '@/components/Lobby';
import { GameTable } from '@/components/GameTable';
import { Tutorial } from '@/components/Tutorial';

export interface Me { pid: string; token: string; code: string }
export interface Known { card: CardInfo; until: number | null } // null = until round starts

export interface Toast { id: number; text: string }

let toastSeq = 1;

export default function Page() {
  const [state, setState] = useState<GameState | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [known, setKnown] = useState<Record<string, Known>>({});
  const [drawnKnown, setDrawnKnown] = useState<Record<string, CardInfo>>({}); // my drawn cards — visible only while in the draw slot
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [peekedBy, setPeekedBy] = useState<Record<string, number>>({}); // cardId -> until (someone looked at it)
  const [wobbleId, setWobbleId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showTutorial, setShowTutorial] = useState(false);
  const lastFxSeq = useRef(0);
  const meRef = useRef<Me | null>(null);
  const prevPhase = useRef<string | null>(null);
  const activeRoomRef = useRef<string | null>(null);

  const toast = useCallback((text: string) => {
    const id = toastSeq++;
    setToasts((t) => [...t.slice(-3), { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const remember = useCallback((card: CardInfo, ms: number | null) => {
    setKnown((k) => ({ ...k, [card.id]: { card, until: ms === null ? null : Date.now() + ms } }));
    setSeen((s) => new Set(s).add(card.id));
    if (ms !== null) {
      setTimeout(() => {
        setKnown((k) => {
          const e = k[card.id];
          if (!e || e.until === null || e.until > Date.now()) return k;
          const rest = { ...k };
          delete rest[card.id];
          return rest;
        });
      }, ms + 60);
    }
  }, []);

  // ---------- fx → sounds + toasts + transient reveals ----------
  const handleFx = useCallback((fx: Fx, st: GameState) => {
    const name = (pid?: string) => st.players.find((p) => p.pid === pid)?.name ?? '???';
    const myPid = meRef.current?.pid;
    switch (fx.type) {
      case 'deal':
        sfx.deal();
        setKnown({});
        setDrawnKnown({});
        setSeen(new Set());
        toast('cards are out — peek at two!');
        break;
      case 'round-start':
        // initial peeks go face-down again
        setKnown((k) => {
          const rest: Record<string, Known> = {};
          for (const [id, e] of Object.entries(k)) if (e.until !== null) rest[id] = e;
          return rest;
        });
        sfx.turn();
        break;
      case 'turn':
        if (fx.pid === myPid) sfx.turn();
        break;
      case 'draw':
        sfx.draw();
        break;
      case 'recycle':
        sfx.deal();
        toast(`${fx.count ?? 'discard'} cards shuffled back into the deck`);
        break;
      case 'discard':
        sfx.discard();
        if (fx.power && fx.pid !== myPid) {
          const label = { 'peek-own': 'peek!', 'peek-other': 'spy!', 'blind-swap': 'swap!', 'peek-swap': 'queen peek!' }[fx.power as 'peek-own' | 'peek-other' | 'blind-swap' | 'peek-swap'];
          toast(`${name(fx.pid)} discarded a power card — ${label}`);
        }
        break;
      case 'swap':
        sfx.swap();
        break;
      case 'peek':
        sfx.peek();
        if (fx.cardId) {
          const cid = fx.cardId;
          setPeekedBy((m) => ({ ...m, [cid]: Date.now() + 2400 }));
          setTimeout(() => setPeekedBy((m) => {
            const rest = { ...m };
            delete rest[cid];
            return rest;
          }), 2500);
        }
        if (fx.pid !== myPid) {
          toast(fx.pid === fx.targetPid
            ? `${name(fx.pid)} peeked at their own card`
            : `${name(fx.pid)} peeked at ${name(fx.targetPid)}'s card`);
        }
        break;
      case 'blind-swap':
        sfx.swap();
        toast(`${name(fx.pid)} ${fx.queen ? 'queen-swapped with' : 'blind-swapped with'} ${name(fx.targetPid)}!`);
        break;
      case 'snap-hit':
        sfx.snapHit();
        toast(fx.pid === fx.victimPid
          ? `⚡ ${name(fx.pid)} snapped their ${fx.top?.r === 'X' ? 'joker' : fx.top?.r}!`
          : `⚡ ${name(fx.pid)} snapped ${name(fx.victimPid)}'s ${fx.top?.r === 'X' ? 'joker' : fx.top?.r}!`);
        break;
      case 'snap-miss':
        sfx.snapMiss();
        if (fx.shown) remember(fx.shown, 3000);
        if (fx.cardId) {
          setWobbleId(fx.cardId);
          setTimeout(() => setWobbleId(null), 700);
        }
        toast(fx.slow
          ? `${name(fx.pid)} snapped right… but too slow! penalty`
          : `${name(fx.pid)} snapped the wrong card — penalty!`);
        break;
      case 'give':
        sfx.give();
        toast(`${name(fx.fromPid)} slid a card to ${name(fx.toPid)}`);
        break;
      case 'cabo':
        sfx.cabo();
        break;
      case 'empty-hand':
        sfx.snapHit();
        toast(`${name(fx.pid)} ran out of cards!`);
        break;
      case 'game-over':
        if (myPid && (fx.pids ?? [fx.pid]).includes(myPid)) sfx.win(); else sfx.lose();
        break;
    }
  }, [toast, remember]);

  useEffect(() => { meRef.current = me; }, [me]);

  // Browsers require a user gesture before WebAudio can play. Keep this
  // listener active because some gestures unlock audio where pointerdown does not.
  useEffect(() => {
    const kick = () => { startMusic(); };
    document.addEventListener('pointerdown', kick, { capture: true });
    document.addEventListener('click', kick, { capture: true });
    document.addEventListener('keydown', kick, { capture: true });
    document.addEventListener('touchend', kick, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', kick, { capture: true });
      document.removeEventListener('click', kick, { capture: true });
      document.removeEventListener('keydown', kick, { capture: true });
      document.removeEventListener('touchend', kick, { capture: true });
    };
  }, []);

  useEffect(() => {
    const s = getSocket();
    const onState = (st: GameState) => {
      if (!activeRoomRef.current || st.code !== activeRoomRef.current) return;
      setState(st);
      // peek phase over → initial peeks always flip back down, even if the
      // round-start fx slid out of the fx window
      if (prevPhase.current === 'peek' && st.phase !== 'peek') {
        setKnown((k) => {
          const rest: Record<string, Known> = {};
          for (const [id, e] of Object.entries(k)) if (e.until !== null) rest[id] = e;
          return rest;
        });
      }
      prevPhase.current = st.phase;
      for (const fx of st.fxs ?? []) {
        if (fx.seq > lastFxSeq.current) {
          lastFxSeq.current = fx.seq;
          handleFx(fx, st);
        }
      }
    };
    const onPrivate = (msg: PrivateMsg) => {
      if (!activeRoomRef.current) return;
      if (msg.type === 'peek') { remember(msg.card, null); sfx.flip(); } // stays face-up through the peek phase
      else if (msg.type === 'drawn') {
        // only visible while it sits in the draw slot — once it joins a hand
        // it goes face-down and you have to remember it!
        setDrawnKnown((m) => ({ ...m, [msg.card.id]: msg.card }));
        setSeen((prev) => new Set(prev).add(msg.card.id));
      }
      else if (msg.type === 'power-peek') { remember(msg.card, 4000); sfx.peek(); }
    };
    s.on('state', onState);
    s.on('private', onPrivate);
    // (re)bind our seat on every connection — a fresh page load AND every
    // socket.io reconnect (the new server-side socket knows nothing about us,
    // so without this the game would freeze on stale state)
    const rejoin = () => {
      try {
        const saved = JSON.parse(localStorage.getItem('cabo-session') || 'null');
        if (saved?.code && saved?.token) {
          s.emit('rejoin', saved, (res: { ok?: boolean; code?: string; token?: string; pid?: string }) => {
            if (res.ok) {
              activeRoomRef.current = res.code!;
              setMe({ pid: res.pid!, token: res.token!, code: res.code! });
            }
            else {
              localStorage.removeItem('cabo-session');
              activeRoomRef.current = null;
              meRef.current = null;
              setMe(null);
              setState(null);
            }
          });
        }
      } catch { /* ignore */ }
    };
    s.on('connect', rejoin);
    if (s.connected) rejoin();
    return () => {
      s.off('state', onState);
      s.off('private', onPrivate);
      s.off('connect', rejoin);
    };
  }, [handleFx, remember]);

  const joined = useCallback((res: { pid: string; token: string; code: string }) => {
    activeRoomRef.current = res.code;
    setMe(res);
    localStorage.setItem('cabo-session', JSON.stringify({ code: res.code, token: res.token }));
  }, []);

  const leave = useCallback(() => {
    activeRoomRef.current = null;
    meRef.current = null;
    getSocket().emit('leave');
    localStorage.removeItem('cabo-session');
    setMe(null);
    setState(null);
    setKnown({});
    setDrawnKnown({});
    setSeen(new Set());
    setPeekedBy({});
    setWobbleId(null);
    setToasts([]);
    prevPhase.current = null;
    lastFxSeq.current = 0;
  }, []);

  const inRoom = me && state && state.players.some((p) => p.pid === me.pid);

  return (
    <>
      <div className="bg-blobs" />
      {!inRoom && <Home onJoined={joined} onTutorial={() => setShowTutorial(true)} />}
      {inRoom && state!.phase === 'lobby' && (
        <Lobby state={state!} me={me!} onLeave={leave} onTutorial={() => setShowTutorial(true)} />
      )}
      {inRoom && state!.phase !== 'lobby' && (
        <GameTable
          state={state!}
          me={me!}
          known={known}
          drawnKnown={drawnKnown}
          seen={seen}
          peekedBy={peekedBy}
          wobbleId={wobbleId}
          onLeave={leave}
          onTutorial={() => setShowTutorial(true)}
        />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">{t.text}</div>
        ))}
      </div>
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </>
  );
}
