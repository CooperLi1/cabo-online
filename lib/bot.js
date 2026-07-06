'use strict';
// Bot players. Each bot keeps an imperfect memory of cards it has seen and
// acts through the same GameRoom methods as humans, on human-ish timers.
//
//   derp   — forgets everything, makes random choices, and occasionally snaps
//            mystery cards with unearned confidence
//   easy   — only remembers its own peeks, forgets a lot, snaps slowly and
//            hesitates; sometimes gambles a snap on a card it never saw
//   medium — remembers its own info a bit better, but still plays gently
//   hard   — old medium behavior: remembers most cards it sees, decent reactions
//   expert — never forgets anything it sees, snaps in a blink, plays tight
//   master — expert memory PLUS card-counting: tracks every value that has
//            been revealed anywhere to compute the true expected value of an
//            unknown card, estimates every opponent's total, times its cabo
//            call against the table, and dumps junk through snap-gives

const BOT_NAMES = ['beep', 'boop', 'chip', 'bitsy', 'zap', 'pixel', 'widget', 'sprocket', 'gizmo'];
const BOT_AVATARS = ['ghost', 'panda', 'penguin', 'frog', 'fox', 'chick', 'bear', 'pig', 'bunny'];

const LEVELS = {
  derp: {
    remember: 'none',
    forgetChance: 1,
    snapDelay: [2200, 5200],
    snapSkip: 0.85,
    gamble: 0.35,
    caboAt: 99,
    actDelay: [1200, 2600],
    derp: true,
  },
  easy: {
    remember: 'own',      // only remembers its own peeked cards
    forgetChance: 0.5,    // per remembered card, per turn
    snapDelay: [1500, 3300],
    snapSkip: 0.7,        // chance to just not notice a snap
    gamble: 0.1,          // chance to snap a card it never saw
    caboAt: 3,
    actDelay: [1100, 2100],
  },
  medium: {
    remember: 'own',
    forgetChance: 0.24,
    snapDelay: [950, 2200],
    snapSkip: 0.4,
    gamble: 0.05,
    caboAt: 5,
    actDelay: [850, 1550],
  },
  hard: {
    remember: 'all',
    forgetChance: 0.12,
    snapDelay: [550, 1300],
    snapSkip: 0.15,
    gamble: 0.02,
    caboAt: 7,
    actDelay: [650, 1200],
  },
  expert: {
    remember: 'all',
    forgetChance: 0,
    snapDelay: [200, 430],
    snapSkip: 0,
    gamble: 0,
    caboAt: 10,
    actDelay: [400, 800],
  },
  master: {
    remember: 'all',
    forgetChance: 0,
    snapDelay: [150, 280],
    snapSkip: 0,
    gamble: 0,
    caboAt: 10,
    actDelay: [350, 700],
    master: true,
  },
};

// total value of the whole 54-card deck under house values
// (4×(1..10)=220, J×4=44, Q×4=48, red K −2, black K 50, jokers 0)
const DECK_TOTAL = 360;
const DECK_SIZE = 54;

const UNKNOWN_EV = 6.6; // expected value of an unseen card
const SPEED_FACTORS = { slow: 1.5, normal: 1, fast: 0.45 };

function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function value(c) {
  if (c.r === 'X') return 0;
  if (c.r === 'K') return c.s === '♥' || c.s === '♦' ? -1 : 25;
  if (c.r === 'Q') return 12;
  if (c.r === 'J') return 11;
  if (c.r === 'A') return 1;
  return parseInt(c.r, 10);
}

class BotBrain {
  constructor(room, player, level) {
    this.room = room;
    this.p = player;
    this.level = LEVELS[level] ? level : 'medium';
    this.cfg = LEVELS[this.level];
    this.memory = new Map(); // cardId -> {r, s} (id-keyed, so swaps don't confuse it)
    this.seenIds = new Set(); // every card whose VALUE has been revealed to us
    this.seenSum = 0;
    this.timers = new Set();
    this.lastKey = '';
    this.lastEpoch = -1;
    this.lastSeq = 0;
    this.peekedThisDeal = false;
  }

  destroy() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  later(ms, fn) {
    const speed = SPEED_FACTORS[this.room.botSpeed] ?? SPEED_FACTORS.normal;
    const t = setTimeout(() => {
      this.timers.delete(t);
      try { fn(); } catch { /* room state moved on — fine */ }
    }, Math.max(80, Math.round(ms * speed)));
    this.timers.add(t);
  }

  note(card) { // card-counting: track every revealed value once
    if (!card || this.seenIds.has(card.id)) return;
    this.seenIds.add(card.id);
    this.seenSum += value(card);
  }

  baseEV() { // expected value of an unknown card
    if (!this.cfg.master) return UNKNOWN_EV;
    const left = DECK_SIZE - this.seenIds.size;
    if (left <= 0) return UNKNOWN_EV;
    const ev = (DECK_TOTAL - this.seenSum) / left;
    return Math.min(Math.max(ev, 2.5), 10.5);
  }

  onPrivate(msg) {
    if (msg.card && this.cfg.remember !== 'none') this.memory.set(msg.card.id, { r: msg.card.r, s: msg.card.s });
    this.note(msg.card);
    // queen power second step happens after the peek result arrives
    if (msg.type === 'power-peek') {
      this.later(rand(700, 1400), () => this.queenStep2(msg.card));
    }
  }

  // ---------- memory helpers ----------

  knownOwn(st) {
    const mine = this.me(st)?.cards ?? [];
    return mine.filter((id) => this.memory.has(id)).map((id) => ({ id, card: this.memory.get(id) }));
  }

  unknownOwn(st) {
    const mine = this.me(st)?.cards ?? [];
    return mine.filter((id) => !this.memory.has(id));
  }

  me(st) { return st.players.find((q) => q.pid === this.p.pid); }

  worstOwn(st) {
    // highest-value card to get rid of; unknown cards count as UNKNOWN_EV
    const mine = this.me(st)?.cards ?? [];
    let worst = null;
    let worstVal = -Infinity;
    const ev = this.baseEV();
    for (const id of mine) {
      const c = this.memory.get(id);
      const v = c ? value(c) : ev;
      if (v > worstVal) { worstVal = v; worst = id; }
    }
    return { id: worst, val: worstVal };
  }

  ownTotal(st) {
    const mine = this.me(st)?.cards ?? [];
    const ev = this.baseEV();
    return mine.reduce((t, id) => {
      const c = this.memory.get(id);
      return t + (c ? value(c) : ev);
    }, 0);
  }

  oppEstimates(st) {
    const ev = this.baseEV();
    const ests = [];
    for (const q of st.players) {
      if (q.pid === this.p.pid) continue;
      let est = 0;
      for (const id of q.cards) {
        const c = this.memory.get(id);
        est += c ? value(c) : ev;
      }
      ests.push(est);
    }
    return ests;
  }

  isKamikazeHand(st) {
    const mine = this.me(st)?.cards ?? [];
    if (mine.length !== 4) return false;
    const cards = mine.map((id) => this.memory.get(id));
    if (cards.some((c) => !c)) return false;
    const bk = cards.filter((c) => c.r === 'K' && c.s !== '♥' && c.s !== '♦').length;
    const face = cards.filter((c) => c.r === 'J' || c.r === 'Q').length;
    return bk === 2 && face === 2;
  }

  forgetPass() {
    if (this.cfg.forgetChance <= 0) return;
    for (const id of [...this.memory.keys()]) {
      if (Math.random() < this.cfg.forgetChance * 0.2) this.memory.delete(id);
    }
  }

  // ---------- main loop ----------

  onState(st) {
    const room = this.room;
    if (room.phase === 'lobby') { this.peekedThisDeal = false; return; }

    // watch public reveals in the fx stream
    for (const fx of st.fxs ?? []) {
      if (fx.seq <= this.lastSeq) continue;
      this.lastSeq = fx.seq;
      if (fx.type === 'deal') {
        this.memory.clear();
        this.seenIds = new Set();
        this.seenSum = 0;
        this.peekedThisDeal = false;
      }
      if (fx.top) this.note(fx.top);
      if (fx.shown) this.note(fx.shown);
      if (fx.type === 'turn') this.forgetPass();
      if (this.cfg.remember === 'all' && fx.type === 'snap-miss' && fx.shown) {
        this.memory.set(fx.shown.id, { r: fx.shown.r, s: fx.shown.s });
      }
    }

    for (const c of st.discard) this.note(c); // pile is public knowledge
    if (st.drawn?.card) this.note(st.drawn.card);
    if (st.phase === 'peek') return this.maybePeek(st);
    if (st.phase !== 'play') return;

    this.maybeSnap(st);
    this.maybeGive(st);
    this.maybeTakeTurn(st);
  }

  maybePeek(st) {
    if (this.peekedThisDeal) return;
    const meP = this.me(st);
    if (!meP || meP.peeksLeft <= 0) return;
    this.peekedThisDeal = true;
    const targets = [...meP.cards].sort(() => Math.random() - 0.5).slice(0, 2);
    targets.forEach((id, i) => {
      this.later(rand(500, 1400) + i * rand(300, 700), () => this.room.peek(this.p, id));
    });
  }

  maybeGive(st) {
    if (!st.pendingGive || st.pendingGive.fromPid !== this.p.pid) return;
    const key = `give:${st.pendingGive.toPid}:${st.snapEpoch}`;
    if (this.lastKey === key) return;
    this.lastKey = key;
    this.later(rand(600, 1300), () => {
      const cur = this.room.publicState();
      if (!cur.pendingGive || cur.pendingGive.fromPid !== this.p.pid) return;
      // hand over the worst card we know about (or a random one)
      const { id } = this.worstOwn(cur);
      const mine = this.me(cur)?.cards ?? [];
      this.room.giveCard(this.p, id ?? pick(mine));
    });
  }

  maybeSnap(st) {
    if (st.snapEpoch === this.lastEpoch || st.discard.length === 0) return;
    this.lastEpoch = st.snapEpoch;
    if (st.snapLocked) return; // pile already snapped — no chains
    if (st.caboPid === this.p.pid) return; // we called cabo — hand is locked in
    if (Math.random() < this.cfg.snapSkip) return;
    const top = st.discard[st.discard.length - 1];

    // find a remembered matching card (own first, then others if we track them)
    let targetId = null;
    if (this.cfg.master) {
      // collect every legal match we know about
      let bestOwn = null; // highest-value own match (clears the most points)
      let opp = null;
      for (const q of st.players) {
        if (q.pid !== this.p.pid && q.pid === st.caboPid) continue;
        for (const id of q.cards) {
          const c = this.memory.get(id);
          if (!c || c.r !== top.r) continue;
          if (q.pid === this.p.pid) {
            if (value(c) < 0) continue; // never give up a red king
            if (!bestOwn || value(c) > bestOwn.val) bestOwn = { id, val: value(c) };
          } else if (!opp) {
            opp = { id };
          }
        }
      }
      const worst = this.worstOwn(st);
      // snapping an opponent lets us hand them our worst card — take that
      // whenever we're sitting on real junk, otherwise shrink our own hand
      targetId = (opp && worst.val >= 7) ? opp.id : bestOwn ? bestOwn.id : opp ? opp.id : null;
    } else {
      for (const q of st.players) {
        if (this.cfg.remember === 'none') continue;
        if (this.cfg.remember === 'own' && q.pid !== this.p.pid) continue;
        if (q.pid !== this.p.pid && q.pid === st.caboPid) continue;
        for (const id of q.cards) {
          const c = this.memory.get(id);
          if (c && c.r === top.r) {
            // never snap away our own red king — it's worth −1!
            if (q.pid === this.p.pid && value(c) < 0) continue;
            targetId = id;
            if (q.pid === this.p.pid) break; // prefer snapping our own
          }
        }
        if (targetId && q.pid === this.p.pid) break;
      }
    }

    // rarely, gamble on a card it never saw
    if (!targetId && Math.random() < this.cfg.gamble) {
      const mine = this.unknownOwn(st);
      if (mine.length) targetId = pick(mine);
    }
    if (!targetId) return;

    const epoch = st.snapEpoch;
    const reaction = rand(this.cfg.snapDelay[0], this.cfg.snapDelay[1]);
    this.later(reaction, () => {
      if (this.room.snapEpoch !== epoch || this.room.phase !== 'play') return;
      this.room.snap(this.p, targetId, 0, Math.round(reaction));
    });
  }

  maybeTakeTurn(st) {
    if (st.turnPid !== this.p.pid || st.pendingGive) return;
    const key = `${st.stage}:${st.snapEpoch}:${st.qPeeked ?? ''}:${st.drawn?.id ?? ''}`;
    if (this.lastKey === key) return;
    this.lastKey = key;

    const delay = rand(this.cfg.actDelay[0], this.cfg.actDelay[1]);

    if (st.stage === 'draw') {
      this.later(delay, () => {
        const cur = this.room.publicState();
        if (cur.turnPid !== this.p.pid || cur.stage !== 'draw' || cur.pendingGive) return;
        const top = cur.discard[cur.discard.length - 1];
        if (this.cfg.derp) {
          if (!cur.caboPid && Math.random() < 0.08) return this.room.callCabo(this.p);
          if (top && Math.random() < 0.45 && (this.me(cur)?.cards.length ?? 0) > 0) return this.room.drawDiscard(this.p);
          return this.room.drawStock(this.p);
        }
        // call cabo when our (believed) total is low enough
        if (this.cfg.master && !cur.caboPid) {
          // a guaranteed-win hand ends the game on the spot
          if (this.isKamikazeHand(cur)) return this.room.callCabo(this.p);
          const knowsAll = this.unknownOwn(cur).length === 0;
          if (knowsAll) {
            const myEst = this.ownTotal(cur);
            const minOpp = Math.min(...this.oppEstimates(cur), Infinity);
            // call on a sure thing, or whenever the table estimate says we
            // lead with margin (ties lose, so demand real daylight)
            if (myEst <= 3 || (myEst + 2 < minOpp && myEst <= 12)) {
              return this.room.callCabo(this.p);
            }
          }
        } else if (!cur.caboPid && this.unknownOwn(cur).length === 0 && this.ownTotal(cur) <= this.cfg.caboAt) {
          return this.room.callCabo(this.p);
        }
        // take a juicy known discard, otherwise draw blind
        const worst = this.worstOwn(cur);
        if (top && value(top) <= 3 && worst.val > value(top) + 2 && (this.me(cur)?.cards.length ?? 0) > 0) {
          this.room.drawDiscard(this.p);
        } else {
          this.room.drawStock(this.p);
        }
      });
      return;
    }

    if (st.stage === 'decide') {
      this.later(delay, () => {
        const cur = this.room.publicState();
        if (cur.turnPid !== this.p.pid || cur.stage !== 'decide') return;
        const drawn = this.room.drawn ? this.room.drawn.card : null;
        if (!drawn) return;
        const dv = value(drawn);
        const worst = this.worstOwn(cur);
        const mustSwap = this.room.drawn.from === 'discard';
        const hasPower = ['7', '8', '9', '10', 'J', 'Q'].includes(drawn.r);
        if (this.cfg.derp && !mustSwap) {
          const mine = this.me(cur)?.cards ?? [];
          if (mine.length && Math.random() < 0.65) return this.room.swapDrawn(this.p, pick(mine));
          return this.room.discardDrawn(this.p);
        }
        // swap in if it beats our worst card; power cards get tossed for their
        // power unless they're a big upgrade
        const upgrade = worst.id && dv < worst.val - (hasPower ? 3 : 0.5);
        if (mustSwap || upgrade) {
          this.room.swapDrawn(this.p, worst.id ?? pick(this.me(cur)?.cards ?? []));
        } else {
          this.room.discardDrawn(this.p);
        }
      });
      return;
    }

    if (st.stage === 'power') {
      this.later(delay, () => {
        const cur = this.room.publicState();
        if (cur.turnPid !== this.p.pid || cur.stage !== 'power') return;
        this.usePower(cur);
      });
    }
  }

  usePower(st) {
    if (this.cfg.derp && Math.random() < 0.7) return this.room.skipPower(this.p);
    const kind = st.powerKind;
    const others = st.players.filter((q) => q.pid !== this.p.pid && q.pid !== st.caboPid && q.cards.length > 0);

    if (kind === 'peek-own') {
      const unknown = this.unknownOwn(st);
      if (unknown.length) return this.room.usePower(this.p, { cardId: pick(unknown) });
      return this.room.skipPower(this.p);
    }
    if (kind === 'peek-other') {
      const targets = others.flatMap((q) => q.cards).filter((id) => !this.memory.has(id));
      if (targets.length) return this.room.usePower(this.p, { cardId: pick(targets) });
      return this.room.skipPower(this.p);
    }
    if (kind === 'blind-swap') {
      const worst = this.worstOwn(st);
      if (!worst.id || !others.length) return this.room.skipPower(this.p);
      // best opponent card we happen to know about (hard/expert track these)
      let steal = null;
      for (const q of others) {
        for (const id of q.cards) {
          const c = this.memory.get(id);
          if (c && (!steal || value(c) < steal.val)) steal = { id, val: value(c) };
        }
      }
      // trade when: we're dumping a known stinker, we know a juicy card to
      // steal, or just to stir the pot (an unknown-for-unknown swap is fair
      // odds and keeps opponents guessing)
      const dumpBad = worst.val >= 8;
      const goodSteal = !!steal && steal.val <= worst.val - 3;
      const chaosTrade = Math.random() < 0.3;
      if (dumpBad || goodSteal || chaosTrade) {
        let theirs = goodSteal ? steal.id : null;
        if (!theirs) {
          const victim = pick(others);
          // don't steal a card we KNOW is worse than what we're giving
          const candidates = victim.cards.filter((id) => {
            const c = this.memory.get(id);
            return !c || value(c) < worst.val;
          });
          theirs = candidates.length ? pick(candidates) : pick(victim.cards);
        }
        return this.room.usePower(this.p, { aId: worst.id, bId: theirs });
      }
      return this.room.skipPower(this.p);
    }
    if (kind === 'peek-swap') {
      if (!st.qPeeked) {
        const targets = others.flatMap((q) => q.cards).filter((id) => !this.memory.has(id));
        const anyTargets = targets.length ? targets : others.flatMap((q) => q.cards);
        if (anyTargets.length) return this.room.usePower(this.p, { cardId: pick(anyTargets) });
        return this.room.skipPower(this.p);
      }
      // step 2 handled in queenStep2 once the peek result arrives
      return;
    }
    this.room.skipPower(this.p);
  }

  queenStep2(peeked) {
    const st = this.room.publicState();
    if (st.turnPid !== this.p.pid || st.stage !== 'power' || st.powerKind !== 'peek-swap' || !st.qPeeked) return;
    if (st.players.some((q) => q.pid === st.caboPid && q.cards.includes(st.qPeeked))) {
      return this.room.skipPower(this.p);
    }
    const worst = this.worstOwn(st);
    if (worst.id && value(peeked) < worst.val - 1) {
      this.room.usePower(this.p, { cardId: worst.id });
    } else {
      this.room.skipPower(this.p);
    }
  }
}

module.exports = { BotBrain, BOT_NAMES, BOT_AVATARS, LEVELS };
