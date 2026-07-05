'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PlayingCard } from './PlayingCard';
import { PixelAvatar } from './PixelAvatar';
import { PixelSprite, EYE, CROWN, LIGHTNING } from './PixelSprite';
import { sfx } from '@/lib/sounds';

// loops through phases with given durations (ms)
function useLoop(durations: number[]) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    let i = 0;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      i = (i + 1) % durations.length;
      setPhase(i);
      t = setTimeout(tick, durations[i]);
    };
    t = setTimeout(tick, durations[0]);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return phase;
}

const spring = { type: 'spring' as const, stiffness: 300, damping: 26 };

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div className="tut-stage">
      <div style={{ position: 'relative', width: 440, height: 255, margin: '0 auto', transformOrigin: 'top center' }} className="tut-scale">
        {children}
      </div>
    </div>
  );
}

// ---------- scene 1: the goal ----------
function GoalScene() {
  const phase = useLoop([900, 900, 900, 900, 1600, 2400]);
  const cards = [
    { r: '2' as const, s: '♣' },
    { r: '5' as const, s: '♥' },
    { r: 'K' as const, s: '♥' },
    { r: 'X' as const, s: '★' },
  ];
  const sums = ['2', '+5', '−1', '+0'];
  const shown = phase >= 5 ? 4 : phase;
  return (
    <Stage>
      {cards.map((c, i) => (
        <div key={i} className="tut-abs" style={{ left: 90 + i * 70, top: 80 }}>
          <PlayingCard id={`g${i}`} noLayout size="md" card={i < shown ? { id: `g${i}`, ...c } : null} />
          <AnimatePresence>
            {i < shown && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="text-center px-body text-lg mt-1">
                {sums[i]}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
      <AnimatePresence>
        {phase >= 4 && (
          <motion.div
            className="tut-abs bubble"
            style={{ left: 168, top: 14, fontSize: '1.2rem' }}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={spring}
          >
            total: 6 ✦
          </motion.div>
        )}
      </AnimatePresence>
    </Stage>
  );
}

// ---------- scene: card values ----------
function ValuesScene() {
  const phase = useLoop([700, 700, 700, 700, 700, 700, 3200]);
  const cards: { r: string; s: string; note: string }[] = [
    { r: 'X', s: '★', note: '0' },
    { r: 'A', s: '♣', note: '1' },
    { r: 'J', s: '♠', note: '11' },
    { r: 'Q', s: '♥', note: '12' },
    { r: 'K', s: '♥', note: '−1 !' },
    { r: 'K', s: '♠', note: '25 !!' },
  ];
  const shown = phase >= 6 ? 6 : phase + 1;
  return (
    <Stage>
      {cards.map((c, i) => (
        <div key={i} className="tut-abs" style={{ left: 28 + i * 66, top: 70 }}>
          <PlayingCard id={`v${i}`} noLayout size="sm"
            card={i < shown ? { id: `v${i}`, r: c.r as 'A', s: c.s } : null} />
          <AnimatePresence>
            {i < shown && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                className="text-center px-body text-lg mt-1"
                style={{ color: c.note.includes('!') ? 'var(--pink-deep)' : undefined }}>
                {c.note}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
      <AnimatePresence>
        {phase >= 6 && (
          <motion.div className="tut-abs bubble" style={{ left: 70, top: 180, fontSize: '0.85rem' }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
            2–10 are just their number · numbers low = happy
          </motion.div>
        )}
      </AnimatePresence>
    </Stage>
  );
}

// ---------- scene 2: peek at two ----------
function PeekScene() {
  const phase = useLoop([1100, 2200, 900, 1400]);
  const up = phase === 1 || phase === 2;
  const faces = [null, null, { id: 'p2', r: '4' as const, s: '♦' }, { id: 'p3', r: 'J' as const, s: '♠' }];
  return (
    <Stage>
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="tut-abs"
          style={{ left: 155 + (i % 2) * 70, top: 45 + Math.floor(i / 2) * 90 }}
          animate={{ y: up && i >= 2 ? -6 : 0 }}
        >
          <PlayingCard id={`p${i}`} noLayout size="md" card={up && i >= 2 ? faces[i] : null} />
        </motion.div>
      ))}
      <AnimatePresence>
        {up && (
          <motion.div className="tut-abs" style={{ left: 90, top: 120 }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
            <PixelSprite grid={EYE} color="#453950" color2="#fffdfa" size={40} />
          </motion.div>
        )}
      </AnimatePresence>
    </Stage>
  );
}

// ---------- scene 3: your turn ----------
function TurnScene() {
  const phase = useLoop([1200, 1400, 1800, 1200, 1400, 2000]);
  // phases: 0 idle · 1 draw card out · 2 swap into hand (old → discard) · 3 idle2 · 4 draw again · 5 toss to discard
  const deck = { x: 60, y: 60 };
  const disc = { x: 320, y: 60 };
  const hand0 = { x: 155, y: 170 };
  const drawnPos = { x: 190, y: 55 };

  return (
    <Stage>
      {/* deck */}
      <div className="tut-abs" style={{ left: deck.x, top: deck.y }}>
        <PlayingCard id="t-deck" noLayout size="md" />
        <div className="pile-label" style={{ position: 'static', transform: 'none', textAlign: 'center', marginTop: 4 }}>deck</div>
      </div>
      {/* discard base */}
      <div className="tut-abs" style={{ left: disc.x, top: disc.y }}>
        <PlayingCard id="t-disc" noLayout size="md" card={{ id: 't-disc', r: '9', s: '♣' }} />
        <div className="pile-label" style={{ position: 'static', transform: 'none', textAlign: 'center', marginTop: 4 }}>discard</div>
      </div>

      {/* hand row */}
      {[0, 1, 2, 3].map((i) => {
        if (i === 0) return null;
        return (
          <div key={i} className="tut-abs" style={{ left: hand0.x + i * 58, top: hand0.y }}>
            <PlayingCard id={`t-h${i}`} noLayout size="sm" />
          </div>
        );
      })}

      {/* the old hand card that gets swapped out */}
      <motion.div
        className="tut-abs"
        initial={false}
        animate={phase >= 2 && phase <= 5
          ? { left: disc.x + 4, top: disc.y + 3, rotate: 8 }
          : { left: hand0.x, top: hand0.y, rotate: 0 }}
        transition={spring}
        style={{ zIndex: 2 }}
      >
        <PlayingCard id="t-old" noLayout size={phase >= 2 ? 'md' : 'sm'} card={phase >= 2 ? { id: 't-old', r: 'Q', s: '♥' } : null} />
      </motion.div>

      {/* first drawn card (3♠) — swapped into hand */}
      <motion.div
        className="tut-abs"
        initial={false}
        animate={
          phase === 1 ? { left: drawnPos.x, top: drawnPos.y, scale: 1.15, opacity: 1 }
            : phase >= 2 && phase <= 5 ? { left: hand0.x, top: hand0.y, scale: 1, opacity: 1 }
              : { left: deck.x, top: deck.y, scale: 1, opacity: phase === 0 ? 0 : 1 }
        }
        transition={spring}
        style={{ zIndex: 3 }}
      >
        <PlayingCard id="t-d1" noLayout size={phase >= 2 && phase !== 1 ? 'sm' : 'md'} card={phase === 1 ? { id: 't-d1', r: '3', s: '♠' } : null} />
      </motion.div>

      {/* second drawn card (K♦) — tossed to discard */}
      <motion.div
        className="tut-abs"
        initial={false}
        animate={
          phase === 4 ? { left: drawnPos.x, top: drawnPos.y, scale: 1.15, opacity: 1 }
            : phase === 5 ? { left: disc.x - 4, top: disc.y + 5, scale: 1, rotate: -7, opacity: 1 }
              : { left: deck.x, top: deck.y, scale: 1, opacity: 0 }
        }
        transition={spring}
        style={{ zIndex: 4 }}
      >
        <PlayingCard id="t-d2" noLayout size="md" card={phase === 4 || phase === 5 ? { id: 't-d2', r: '10', s: '♦' } : null} />
      </motion.div>

      <AnimatePresence>
        {phase === 2 && (
          <motion.div className="tut-abs bubble" style={{ left: 130, top: 8 }} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            swap it in!
          </motion.div>
        )}
        {phase === 5 && (
          <motion.div className="tut-abs bubble" style={{ left: 230, top: 8 }} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            …or toss it!
          </motion.div>
        )}
      </AnimatePresence>
    </Stage>
  );
}

// ---------- scene 4: powers ----------
function PowersScene() {
  const phase = useLoop([2600, 2600, 2600, 2600]);
  const powers = [
    { ranks: ['7', '8'], icon: <PixelSprite grid={EYE} color="#453950" color2="#fffdfa" size={44} />, label: 'tap one of YOUR cards to peek at it' },
    { ranks: ['9', '10'], icon: <PixelSprite grid={EYE} color="#7a63b8" color2="#fffdfa" size={44} />, label: "tap someone ELSE's card to spy on it" },
    { ranks: ['J'], icon: <span style={{ fontSize: 34 }}>🔀</span>, label: 'jack: blind-swap — tap one of yours + one of theirs, no peeking' },
    { ranks: ['Q'], icon: <PixelSprite grid={CROWN} color="#f5c94f" size={48} />, label: "queen: peek someone ELSE's card, then swap it with one of yours if you like" },
  ];
  const p = powers[phase];
  return (
    <Stage>
      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          initial={{ x: 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -60, opacity: 0 }}
          transition={spring}
          className="power-tut-content"
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {p.ranks.map((r) => (
              <PlayingCard key={r} id={`pw${r}`} noLayout size="md"
                card={{ id: `pw${r}`, r: r as '7', s: r === 'K' ? '♠' : '♦' }} />
            ))}
            <div style={{ marginLeft: 8 }}>{p.icon}</div>
          </div>
          <div className="bubble power-tut-callout">{p.label}</div>
        </motion.div>
      </AnimatePresence>
      <div className="tut-abs px-body power-tut-note">
        powers trigger when you toss the drawn card straight onto the pile
      </div>
    </Stage>
  );
}

// ---------- scene 5: snap ----------
function SnapScene() {
  const phase = useLoop([1400, 1400, 2000, 1400, 1600, 2200]);
  // 0 idle · 1 flip 7♣ · 2 fly to pile SNAP! · 3 reset · 4 wrong card flies · 5 bounce back + penalty
  const disc = { x: 250, y: 40 };
  const hand = { x: 90, y: 160 };
  const snapFly = phase === 2;
  const wrongFly = phase === 4;
  const wrongBack = phase === 5;
  return (
    <Stage>
      <div className="tut-abs" style={{ left: disc.x, top: disc.y }}>
        <PlayingCard id="s-disc" noLayout size="md" card={{ id: 's-disc', r: '7', s: '♦' }} />
        <div className="pile-label" style={{ position: 'static', transform: 'none', textAlign: 'center', marginTop: 4 }}>discard</div>
      </div>

      {/* matching card */}
      <motion.div
        className="tut-abs"
        initial={false}
        animate={snapFly ? { left: disc.x + 5, top: disc.y + 4, rotate: 10 } : { left: hand.x, top: hand.y, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        style={{ zIndex: 3 }}
      >
        <PlayingCard id="s-match" noLayout size="md" card={phase >= 1 && phase <= 2 ? { id: 's-match', r: '7', s: '♣' } : null} />
      </motion.div>

      {/* wrong card */}
      <motion.div
        className="tut-abs"
        initial={false}
        animate={wrongFly ? { left: disc.x - 30, top: disc.y + 30, rotate: -14 } : { left: hand.x + 70, top: hand.y, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 24 }}
        style={{ zIndex: 3 }}
      >
        <PlayingCard id="s-wrong" noLayout size="md" wobble={wrongBack}
          card={phase === 4 || phase === 5 ? { id: 's-wrong', r: '4', s: '♠' } : null} />
      </motion.div>

      {/* penalty card sliding in */}
      <AnimatePresence>
        {wrongBack && (
          <motion.div className="tut-abs" style={{ zIndex: 2 }}
            initial={{ left: 380, top: 30, opacity: 0, rotate: 20 }}
            animate={{ left: hand.x + 140, top: hand.y, opacity: 1, rotate: 0 }}
            transition={spring}>
            <PlayingCard id="s-pen" noLayout size="md" />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {snapFly && (
          <motion.div className="tut-abs snap-burst" style={{ left: disc.x - 40, top: disc.y - 32, fontSize: '1.8rem', zIndex: 5 }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ opacity: 0 }}>
            SNAP! ⚡
          </motion.div>
        )}
        {wrongBack && (
          <motion.div className="tut-abs bubble" style={{ left: disc.x + 60, top: disc.y + 40, zIndex: 5, color: 'var(--pink-deep)' }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ opacity: 0 }}>
            wrong! +1 card
          </motion.div>
        )}
      </AnimatePresence>

      <div className="tut-abs" style={{ left: 30, top: 40 }}>
        <PixelSprite grid={LIGHTNING} color="#f5c94f" size={34} className="float-bob" />
      </div>
    </Stage>
  );
}

// ---------- scene 6: cabo! ----------
function CaboScene() {
  const phase = useLoop([1400, 1800, 1400, 1400, 2600]);
  // 0 idle · 1 CABO! bubble · 2-3 others' last turns · 4 reveal + crown
  return (
    <Stage>
      <div className="tut-abs" style={{ left: 60, top: 90 }}>
        <PixelAvatar id="cat" size={64} className={phase === 1 ? 'float-bob' : ''} />
        <AnimatePresence>
          {phase >= 1 && phase < 4 && (
            <motion.div className="bubble" style={{ position: 'absolute', top: -38, left: 30, whiteSpace: 'nowrap', color: 'var(--pink-deep)' }}
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={spring}>
              CABO!
            </motion.div>
          )}
          {phase === 4 && (
            <motion.div style={{ position: 'absolute', top: -30, left: 16 }} initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
              <PixelSprite grid={CROWN} color="#f5c94f" size={36} />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {phase === 4 && (
            <motion.div className="tut-abs" style={{ top: 74, left: -20, display: 'flex', gap: 4, width: 160 }}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {[{ r: 'A', s: '♣' }, { r: '2', s: '♥' }, { r: 'X', s: '★' }, { r: '3', s: '♦' }].map((c, i) => (
                <PlayingCard key={i} id={`cb${i}`} noLayout size="xs" card={{ id: `cb${i}`, r: c.r as 'A', s: c.s }} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* other players take one last turn */}
      {[0, 1].map((i) => (
        <div key={i} className="tut-abs" style={{ left: 250 + i * 90, top: 60 }}>
          <PixelAvatar id={i === 0 ? 'frog' : 'ghost'} size={48} className={(phase === 2 && i === 0) || (phase === 3 && i === 1) ? 'float-bob' : ''} />
          <AnimatePresence>
            {((phase === 2 && i === 0) || (phase === 3 && i === 1)) && (
              <motion.div className="bubble" style={{ position: 'absolute', top: -34, left: 20, whiteSpace: 'nowrap', fontSize: '0.8rem' }}
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                one last turn…
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      <AnimatePresence>
        {phase === 4 && (
          <motion.div className="tut-abs bubble" style={{ left: 220, top: 170, maxWidth: 200, textAlign: 'center', fontSize: '0.85rem' }}
            initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
            cards flip — lowest total wins! (ties beat the caller)
          </motion.div>
        )}
      </AnimatePresence>
    </Stage>
  );
}

// ---------- the tutorial shell ----------

const STEPS = [
  {
    title: 'the goal 🌟',
    caption: 'everyone gets 4 secret cards, laid out in front of them. keep your total LOW — the lowest hand wins.',
    scene: GoalScene,
  },
  {
    title: 'card values 🔢',
    caption: 'jokers 0 · aces 1 · jack 11 · queen 12 · RED kings −1 (treasure!) · BLACK kings 25 (poison!)',
    scene: ValuesScene,
  },
  {
    title: 'peek at two 👀',
    caption: 'at the start, tap TWO of your cards to peek. memorize them — they flip back down and stay hidden!',
    scene: PeekScene,
  },
  {
    title: 'your turn 🎴',
    caption: 'tap the deck (or the discard pile) to draw. then tap one of your cards to swap — the new card lands face-down in that same spot — or tap the discard pile to toss the draw away.',
    scene: TurnScene,
  },
  {
    title: 'power cards ✨',
    caption: 'toss a power card straight onto the pile and it activates:',
    scene: PowersScene,
  },
  {
    title: 'SNAP! ⚡',
    caption: 'if a card matches the TOP of the discard pile, tap it to snap — anyone\'s cards, anytime, fastest tap wins! snap someone else\'s card and you hand them one of yours. wrong card OR too slow = penalty card.',
    scene: SnapScene,
  },
  {
    title: 'winning 📣',
    caption: 'think you\'re lowest? call CABO — everyone else gets one last turn, then all cards flip and lowest total wins (ties beat the caller). snap away ALL your cards to win instantly. or go kamikaze: end with 2 black kings + 2 face cards for a surprise win!',
    scene: CaboScene,
  },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const S = STEPS[step].scene;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{STEPS[step].title}</h2>
          <button className="btn btn-small btn-round" onClick={onClose}>✕</button>
        </div>
        <S key={step} />
        <p className="tut-caption px-1">{STEPS[step].caption}</p>
        <div className="tut-dots my-3">
          {STEPS.map((_, i) => (
            <button key={i} className={`tut-dot ${i === step ? 'on' : ''}`} onClick={() => setStep(i)} aria-label={`step ${i + 1}`} />
          ))}
        </div>
        <div className="flex justify-between">
          <button className="btn btn-small" disabled={step === 0} onClick={() => { sfx.click(); setStep(step - 1); }}>
            ← back
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn btn-small btn-primary" onClick={() => { sfx.click(); setStep(step + 1); }}>
              next →
            </button>
          ) : (
            <button className="btn btn-small btn-mint" onClick={onClose}>let&apos;s play!</button>
          )}
        </div>
      </div>
    </div>
  );
}
