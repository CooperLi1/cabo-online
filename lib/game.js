'use strict';
// cabo game engine — authoritative server-side rules.
// Rooms hold players, deck state, and a small phase machine:
//   lobby -> peek -> play -> gameOver -> (start again)
// Snap attempts race inside a short grace window and are ordered by TRUE
// reaction speed: each client measures the time from the snappable card
// appearing on its own screen to the tap, so network lag doesn't decide the
// race. The server sanity-checks that claim against its own latency-adjusted
// estimate, and near-simultaneous snaps (<15ms apart) are a coin flip.

const { BotBrain, BOT_NAMES, BOT_AVATARS, LEVELS } = require('./bot');

// runs on the Node server AND in the browser (offline practice mode), so we
// use the Web Crypto API (global in Node 19+) and avoid node-only builtins
function randInt(maxExclusive) {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}
const defer = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const SUITS = ['♥', '♦', '♣', '♠'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const MAX_PLAYERS = 12;
const MIN_PLAYERS = 2;

const PEEK_MS = 25000;
const TURN_MS = 45000; // default; hosts pick 3–120s per room
const GIVE_MS = 15000;
const SNAP_GRACE_MS = 220;
const PEEK_LINGER_MS = 2500;
const BOT_SPEEDS = new Set(['slow', 'normal', 'fast']);

function rid(n = 8) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[randInt(CODE_CHARS.length)];
  return s;
}

function buildDeck() {
  const cards = [];
  for (const s of SUITS) for (const r of RANKS) cards.push({ id: rid(6), r, s });
  cards.push({ id: rid(6), r: 'X', s: '★' });
  cards.push({ id: rid(6), r: 'X', s: '★' });
  shuffleCards(cards);
  return cards;
}

function shuffleCards(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
}

function isRed(c) { return c.s === '♥' || c.s === '♦'; }

function cardValue(c) {
  if (c.r === 'X') return 0;
  if (c.r === 'K') return isRed(c) ? -1 : 25;
  if (c.r === 'Q') return 12;
  if (c.r === 'J') return 11;
  if (c.r === 'A') return 1;
  return parseInt(c.r, 10);
}

function powerOf(c) {
  if (c.r === '7' || c.r === '8') return 'peek-own';
  if (c.r === '9' || c.r === '10') return 'peek-other';
  if (c.r === 'J') return 'blind-swap';
  if (c.r === 'Q') return 'peek-swap'; // peek someone else's card, then optionally swap it with yours
  return null; // all other ranks are just card values
}

// kamikaze: exactly two black kings + two face cards (J/Q) = instant win
function isKamikaze(hand) {
  if (hand.length !== 4) return false;
  const bk = hand.filter((c) => c.r === 'K' && !isRed(c)).length;
  const face = hand.filter((c) => c.r === 'J' || c.r === 'Q').length;
  return bk === 2 && face === 2;
}

class GameRoom {
  constructor(code, emit) {
    this.code = code;
    this.emit = emit; // { toRoom(event, payload), toPlayer(player, event, payload) }
    this.turnMs = TURN_MS;
    this.botSpeed = 'normal';
    this.players = [];
    this.phase = 'lobby';
    this.deck = [];
    this.discard = [];
    this.turnIdx = 0;
    this.stage = null; // 'draw' | 'decide' | 'power' | null
    this.drawn = null; // { card, from: 'stock'|'discard' }
    this.power = null; // { kind, qPeeked: cardId|null }
    this.caboIdx = null;
    this.round = 0;
    this.snapEpoch = 0;
    this.snapAttempts = [];
    this.snapTried = new Set();
    this.snapCooldownUntil = new Map();
    this.snapTimer = null;
    this.pendingGive = null; // { fromPid, toPid }
    this.timer = null;
    this.deadline = null;
    this.seq = 0;
    this.fxLog = [];
    this.reveal = null;
    this.roundResults = null;
    this.winnerPid = null;
    this.winnerPids = [];
    this.emptyAt = null;
    // safety net: if a play-phase room ever has nothing scheduled (no turn
    // timer, no give, no snap resolution pending), nudge it forward
    this.watchdog = setInterval(() => {
      if (this.phase !== 'play') return;
      if (this.timer || this.pendingGive || this.snapTimer) return;
      console.warn('[cabo] watchdog nudge', this.code, 'stage=', this.stage);
      if (this.stage) this.autoPlay();
      else this.nextTurn();
    }, 4000);
    this.watchdog.unref?.();
  }

  // ---------- helpers ----------

  playerByToken(t) { return this.players.find((p) => p.token === t); }
  playerByPid(pid) { return this.players.find((p) => p.pid === pid); }
  cur() { return this.players[this.turnIdx]; }
  caboProtectedPid() {
    return this.caboIdx !== null && this.players[this.caboIdx] ? this.players[this.caboIdx].pid : null;
  }
  isCaboProtectedTarget(player, actor) {
    return !!player && player !== actor && player.pid === this.caboProtectedPid();
  }
  hasLegalPowerTarget(p, kind) {
    if (!p || p.hand.length === 0) return false;
    if (kind === 'peek-own') return true;
    if (kind === 'peek-other' || kind === 'blind-swap' || kind === 'peek-swap') {
      return this.players.some((q) => q !== p && q.hand.length > 0 && !this.isCaboProtectedTarget(q, p));
    }
    return false;
  }

  findCard(cardId) {
    for (const p of this.players) {
      const i = p.hand.findIndex((c) => c.id === cardId);
      if (i >= 0) return { owner: p, index: i, card: p.hand[i] };
    }
    return null;
  }

  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.deadline = null;
      fn();
    }, ms);
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = null;
  }

  sendPrivate(p, payload) {
    if (p.botBrain) p.botBrain.onPrivate(payload);
    else this.emit.toPlayer(p, 'private', payload);
  }

  fx(type, data = {}) {
    this.fxLog.push({ type, seq: ++this.seq, ...data });
    if (this.fxLog.length > 20) this.fxLog.shift();
  }

  drawFromStock() {
    if (this.deck.length === 0) {
      // When the stock runs dry, recycle every discarded card into a fresh stock.
      if (this.discard.length > 0) {
        const recycledCount = this.discard.length;
        this.deck = this.discard.splice(0);
        shuffleCards(this.deck);
        this.snapEpoch++;
        this.snapLocked = false;
        this.snapAttempts = [];
        this.snapTried = new Set();
        if (this.snapTimer) { clearTimeout(this.snapTimer); this.snapTimer = null; }
        this.fx('recycle', { count: recycledCount });
      }
    }
    return this.deck.pop() || null;
  }

  placeOnDiscard(card, fromSnap = false) {
    this.discard.push(card);
    this.snapEpoch++;
    this.snapEpochAt = Date.now();
    this.snapLocked = fromSnap; // a snapped card can't be snapped again — no chains
    this.snapAttempts = [];
    this.snapTried = new Set();
    if (this.snapTimer) { clearTimeout(this.snapTimer); this.snapTimer = null; }
  }

  // ---------- lobby ----------

  addPlayer({ name, avatar, token }) {
    if (this.phase !== 'lobby') {
      // allow rejoin mid-game by token
      const existing = token && this.playerByToken(token);
      if (existing) return existing;
      return { error: 'Game already started' };
    }
    if (this.players.length >= MAX_PLAYERS) return { error: 'Room is full' };
    const p = {
      token: token || rid(12),
      pid: rid(5),
      name: String(name || 'player').slice(0, 14),
      avatar: String(avatar || 'cat'),
      connected: true,
      hand: [],
      peeksLeft: 0,
    };
    this.players.push(p);
    this.fx('join', { pid: p.pid });
    return p;
  }

  removePlayer(p) {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    if (this.phase === 'lobby') {
      this.players.splice(i, 1);
      this.fx('leave', { pid: p.pid });
    } else {
      p.connected = false;
      if (this.phase === 'play' && this.players[this.turnIdx] === p && !this.pendingGive) {
        this.autoPlay();
      }
      if (this.pendingGive && this.pendingGive.fromPid === p.pid) this.autoGive();
    }
    this.broadcast();
  }

  setTurnMs(byPlayer, ms) {
    if (this.phase !== 'lobby') return;
    if (byPlayer.pid !== this.hostPid()) return;
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return;
    this.turnMs = Math.round(Math.min(Math.max(ms, 3000), 120000) / 1000) * 1000;
    this.broadcast();
  }

  setBotSpeed(byPlayer, speed) {
    if (this.phase !== 'lobby') return;
    if (byPlayer.pid !== this.hostPid()) return;
    if (!BOT_SPEEDS.has(speed)) return;
    this.botSpeed = speed;
    this.broadcast();
  }

  hostPid() {
    const humans = this.players.filter((p) => !p.isBot);
    const host = humans.find((p) => p.connected) || humans[0];
    return host ? host.pid : null;
  }

  // ---------- bots ----------

  addBot(byPlayer, level) {
    if (this.phase !== 'lobby') return;
    if (byPlayer.pid !== this.hostPid()) return;
    if (this.players.length >= MAX_PLAYERS) return;
    if (!LEVELS[level]) level = 'medium';
    const used = new Set(this.players.map((p) => p.name));
    const usedAv = new Set(this.players.map((p) => p.avatar));
    let name = BOT_NAMES.find((n) => !used.has(n)) || `bot${this.players.length}`;
    if (level === 'derp') {
      name = 'derp';
      for (let n = 2; used.has(name); n++) name = `derp${n}`;
    }
    const avatar = BOT_AVATARS.find((a) => !usedAv.has(a)) || BOT_AVATARS[0];
    const p = {
      token: rid(12),
      pid: rid(5),
      name,
      avatar,
      connected: true,
      hand: [],
      peeksLeft: 0,
      isBot: true,
      botLevel: level,
    };
    p.botBrain = new BotBrain(this, p, level);
    this.players.push(p);
    this.fx('join', { pid: p.pid, bot: true });
    this.broadcast();
  }

  removeBot(byPlayer, pid) {
    if (this.phase !== 'lobby') return;
    if (byPlayer.pid !== this.hostPid()) return;
    const i = this.players.findIndex((p) => p.pid === pid && p.isBot);
    if (i < 0) return;
    this.players[i].botBrain.destroy();
    this.players.splice(i, 1);
    this.fx('leave', { pid });
    this.broadcast();
  }

  // ---------- round setup ----------

  start(byPlayer) {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') return;
    if (byPlayer.pid !== this.hostPid()) return;
    if (this.players.length < MIN_PLAYERS) return;
    const lastWinnerIdx = this.winnerPid ? this.players.findIndex((p) => p.pid === this.winnerPid) : -1;
    this.winnerPid = null;
    this.winnerPids = [];
    this.round++;
    this.deck = buildDeck();
    this.discard = [];
    this.caboIdx = null;
    this.drawn = null;
    this.power = null;
    this.pendingGive = null;
    this.reveal = null;
    this.roundResults = null;
    this.snapCooldownUntil.clear();
    for (const p of this.players) {
      p.hand = [];
      p.peeksLeft = 2;
    }
    for (let k = 0; k < 4; k++) for (const p of this.players) p.hand.push(this.deck.pop());
    this.placeOnDiscard(this.deck.pop());
    // previous winner leads the next game
    this.turnIdx = lastWinnerIdx >= 0 ? lastWinnerIdx : (this.round - 1) % this.players.length;
    this.startedAt = Date.now();
    const bots = this.players.filter((q) => q.isBot).length;
    console.log(`[stats] game_start code=${this.code} players=${this.players.length} bots=${bots} turnMs=${this.turnMs}`);
    this.phase = 'peek';
    this.stage = null;
    this.fx('deal', { round: this.round });
    this.setTimer(PEEK_MS, () => this.endPeek());
    this.broadcast();
  }

  peek(p, cardId) {
    if (this.phase !== 'peek' || p.peeksLeft <= 0) return;
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    p.peeksLeft--;
    const c = p.hand[idx];
    this.sendPrivate(p, { type: 'peek', card: { id: c.id, r: c.r, s: c.s } });
    if (p.peeksLeft === 0 && this.players.every((q) => q.peeksLeft === 0 || !q.connected)) {
      this.setTimer(PEEK_LINGER_MS, () => this.endPeek());
    }
    this.broadcast();
  }

  endPeek() {
    if (this.phase !== 'peek') return;
    this.phase = 'play';
    this.fx('round-start', {});
    this.beginTurn(this.turnIdx);
  }

  // ---------- turns ----------

  beginTurn(idx) {
    this.turnIdx = idx;
    this.stage = 'draw';
    this.drawn = null;
    this.power = null;
    if (this.caboIdx !== null && idx === this.caboIdx) {
      return this.endRound();
    }
    const p = this.cur();
    if (!p.connected) {
      this.broadcast();
      this.setTimer(3000, () => this.autoPlay());
      return;
    }
    this.fx('turn', { pid: p.pid });
    this.setTimer(this.turnMs, () => this.autoPlay());
    this.broadcast();
  }

  nextTurn() {
    this.beginTurn((this.turnIdx + 1) % this.players.length);
  }

  autoPlay() {
    if (this.phase !== 'play') return;
    if (this.pendingGive) return; // wait for give to resolve first
    if (this.stage === 'draw') {
      const c = this.drawFromStock();
      if (!c) return this.endRound(null, { lowestTotalOnly: true });
      this.drawn = { card: c, from: 'stock' };
      this.stage = 'decide';
      this.discardDrawn(this.cur(), { auto: true });
    } else if (this.stage === 'decide') {
      if (this.drawn.from === 'discard') {
        // must swap: pick a random own card
        const p = this.cur();
        const target = p.hand[randInt(Math.max(p.hand.length, 1))];
        if (target) this.swapDrawn(p, target.id);
        else this.discardDrawn(p, { auto: true, force: true });
      } else {
        this.discardDrawn(this.cur(), { auto: true });
      }
    } else if (this.stage === 'power') {
      this.skipPower(this.cur());
    }
  }

  callCabo(p) {
    if (this.phase !== 'play' || this.stage !== 'draw') return;
    if (this.cur() !== p || this.caboIdx !== null || this.pendingGive) return;
    this.caboIdx = this.turnIdx;
    this.fx('cabo', { pid: p.pid });
    this.nextTurn();
  }

  drawStock(p) {
    if (this.phase !== 'play' || this.stage !== 'draw' || this.cur() !== p || this.pendingGive) return;
    const c = this.drawFromStock();
    if (!c) return this.endRound(null, { lowestTotalOnly: true });
    this.drawn = { card: c, from: 'stock' };
    this.stage = 'decide';
    this.fx('draw', { pid: p.pid, cardId: c.id, from: 'stock' });
    this.sendPrivate(p, { type: 'drawn', card: { id: c.id, r: c.r, s: c.s } });
    this.setTimer(this.turnMs, () => this.autoPlay());
    this.broadcast();
  }

  drawDiscard(p) {
    if (this.phase !== 'play' || this.stage !== 'draw' || this.cur() !== p || this.pendingGive) return;
    if (this.discard.length === 0 || p.hand.length === 0) return;
    const c = this.discard.pop();
    this.drawn = { card: c, from: 'discard' };
    this.stage = 'decide';
    this.fx('draw', { pid: p.pid, cardId: c.id, from: 'discard' });
    this.sendPrivate(p, { type: 'drawn', card: { id: c.id, r: c.r, s: c.s } });
    this.setTimer(this.turnMs, () => this.autoPlay());
    this.broadcast();
  }

  swapDrawn(p, cardId) {
    if (this.phase !== 'play' || this.stage !== 'decide' || this.cur() !== p) return;
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const old = p.hand[idx];
    const incoming = this.drawn.card;
    const from = this.drawn.from;
    p.hand[idx] = incoming;
    this.drawn = null;
    this.placeOnDiscard(old);
    this.fx('swap', { pid: p.pid, outId: old.id, inId: incoming.id, from, top: { id: old.id, r: old.r, s: old.s } });
    this.stage = null;
    this.broadcast();
    this.afterSnapPause(() => this.nextTurn());
  }

  discardDrawn(p, opts = {}) {
    if (this.phase !== 'play' || this.stage !== 'decide' || this.cur() !== p) return;
    if (this.drawn.from === 'discard' && !opts.force) return; // taken discard must be swapped
    const c = this.drawn.card;
    this.drawn = null;
    this.placeOnDiscard(c);
    const kind = powerOf(c);
    this.fx('discard', { pid: p.pid, top: { id: c.id, r: c.r, s: c.s }, power: kind });
    if (kind && !opts.auto && this.hasLegalPowerTarget(p, kind)) {
      this.stage = 'power';
      this.power = { kind, qPeeked: null };
      this.setTimer(Math.min(this.turnMs, 30000), () => this.skipPower(p));
      this.broadcast();
    } else {
      this.stage = null;
      this.broadcast();
      this.afterSnapPause(() => this.nextTurn());
    }
  }

  // small pause so a fresh discard is snappable before the next turn begins;
  // snapping stays open after too — this just gives the moment room to breathe.
  // the continuation is stored so a snap+give interrupting the pause (which
  // clears the timer) still advances the turn once the give resolves.
  afterSnapPause(fn) {
    this.afterGive = fn;
    this.setTimer(1100, () => {
      if (this.pendingGive) return; // resumeAfterGive picks it up
      const f = this.afterGive;
      this.afterGive = null;
      if (f) f();
    });
  }

  skipPower(p) {
    if (this.phase !== 'play' || this.stage !== 'power' || this.cur() !== p) return;
    this.stage = null;
    this.power = null;
    this.fx('power-skip', { pid: p.pid });
    this.broadcast();
    this.afterSnapPause(() => this.nextTurn());
  }

  usePower(p, payload = {}) {
    if (this.phase !== 'play' || this.stage !== 'power' || this.cur() !== p) return;
    const kind = this.power.kind;
    const done = () => {
      this.stage = null;
      this.power = null;
      this.broadcast();
      this.afterSnapPause(() => this.nextTurn());
    };

    if (kind === 'peek-own' || kind === 'peek-other') {
      const found = this.findCard(payload.cardId);
      if (!found) return;
      if (kind === 'peek-own' && found.owner !== p) return;
      if (kind === 'peek-other' && found.owner === p) return;
      if (kind === 'peek-other' && this.isCaboProtectedTarget(found.owner, p)) return;
      this.sendPrivate(p, {
        type: 'power-peek',
        card: { id: found.card.id, r: found.card.r, s: found.card.s },
        ownerPid: found.owner.pid,
      });
      this.fx('peek', { pid: p.pid, targetPid: found.owner.pid, cardId: found.card.id });
      return done();
    }

    if (kind === 'blind-swap') {
      const a = this.findCard(payload.aId);
      const b = this.findCard(payload.bId);
      if (!a || !b) return;
      const mine = a.owner === p ? a : b.owner === p ? b : null;
      const theirs = a.owner !== p ? a : b.owner !== p ? b : null;
      if (!mine || !theirs) return;
      if (this.isCaboProtectedTarget(theirs.owner, p)) return;
      const tmp = mine.owner.hand[mine.index];
      mine.owner.hand[mine.index] = theirs.owner.hand[theirs.index];
      theirs.owner.hand[theirs.index] = tmp;
      this.fx('blind-swap', { pid: p.pid, aId: payload.aId, bId: payload.bId, targetPid: theirs.owner.pid });
      return done();
    }

    if (kind === 'peek-swap') {
      if (!this.power.qPeeked) {
        const found = this.findCard(payload.cardId);
        if (!found) return;
        if (found.owner === p) return;
        if (this.isCaboProtectedTarget(found.owner, p)) return;
        this.power.qPeeked = found.card.id;
        this.sendPrivate(p, {
          type: 'power-peek',
          card: { id: found.card.id, r: found.card.r, s: found.card.s },
          ownerPid: found.owner.pid,
        });
        this.fx('peek', { pid: p.pid, targetPid: found.owner.pid, cardId: found.card.id });
        this.setTimer(Math.min(this.turnMs, 30000), () => this.skipPower(p));
        this.broadcast();
        return;
      }
      // second step: optionally swap peeked card with one of your own
      const target = this.findCard(this.power.qPeeked);
      const mine = this.findCard(payload.cardId);
      if (!target || !mine || mine.owner !== p || target.owner === p) return;
      if (this.isCaboProtectedTarget(target.owner, p)) return;
      const tmp = mine.owner.hand[mine.index];
      mine.owner.hand[mine.index] = target.owner.hand[target.index];
      target.owner.hand[target.index] = tmp;
      this.fx('blind-swap', { pid: p.pid, aId: payload.cardId, bId: this.power.qPeeked, targetPid: target.owner.pid, queen: true });
      return done();
    }
  }

  // ---------- snapping ----------
  // Anyone may snap the top discard at any time during play. Attempts within a
  // short grace window race by estimated press time (arrival - rtt/2).

  snap(p, cardId, rtt = 0, reaction = null) {
    if (this.phase !== 'play' || this.discard.length === 0) return;
    if (this.caboIdx !== null && this.players[this.caboIdx] === p) return; // caller has locked in
    const mutedUntil = this.snapCooldownUntil.get(p.pid) || 0;
    if (mutedUntil > Date.now()) return;
    if (mutedUntil) this.snapCooldownUntil.delete(p.pid);
    if (this.snapTried.has(p.pid)) return;
    if (this.drawn && this.drawn.card.id === cardId) return;
    const found = this.findCard(cardId);
    if (!found) return;
    if (this.isCaboProtectedTarget(found.owner, p)) return;
    this.snapTried.add(p.pid);
    if (this.snapLocked) {
      // the pile was already snapped — too late! penalty, and everyone sees
      // which card they tried to slap
      const penalty = this.drawFromStock();
      if (!penalty) return this.endRound(null, { lowestTotalOnly: true });
      p.hand.push(penalty);
      this.fx('snap-miss', {
        pid: p.pid, cardId, slow: true,
        shown: { id: found.card.id, r: found.card.r, s: found.card.s },
      });
      this.broadcast();
      return;
    }
    // reaction = client-measured ms from "card appeared on my screen" to tap.
    // serverEst = our latency-adjusted estimate of the same thing; used as a
    // fallback and as an anti-cheat bound on the client's claim.
    const serverEst = Math.max(Date.now() - (this.snapEpochAt || 0) - Math.min(rtt, 600), 80);
    let at = typeof reaction === 'number' && reaction > 0
      ? Math.min(Math.max(reaction, 100), serverEst + 400)
      : serverEst;
    this.snapAttempts.push({
      p, cardId, at,
      epoch: this.snapEpoch,
    });
    if (!this.snapTimer) {
      const epoch = this.snapEpoch;
      this.snapTimer = setTimeout(() => {
        this.snapTimer = null;
        if (this.snapEpoch === epoch) this.resolveSnaps();
      }, SNAP_GRACE_MS);
    }
  }

  resolveSnaps() {
    const attempts = this.snapAttempts.filter((a) => a.epoch === this.snapEpoch);
    this.snapAttempts = [];
    if (attempts.length === 0) return;
    // effectively-simultaneous snaps (within 15ms) are decided by luck
    for (const a of attempts) a.key = a.at + Math.random() * 15;
    attempts.sort((a, b) => a.key - b.key);
    const topRank = this.discard[this.discard.length - 1].r;
    let winner = null;
    for (const a of attempts) {
      const found = this.findCard(a.cardId);
      if (!found) continue; // card moved away in the meantime
      const correct = found.card.r === topRank;
      if (!winner && correct) {
        winner = a;
        const card = found.owner.hand.splice(found.index, 1)[0];
        const victim = found.owner;
        this.placeOnDiscard(card, true);
        const settleUntil = Date.now() + 900;
        for (const attempt of attempts) this.snapCooldownUntil.set(attempt.p.pid, settleUntil);
        this.fx('snap-hit', {
          pid: a.p.pid, victimPid: victim.pid, top: { id: card.id, r: card.r, s: card.s },
        });
        if (victim !== a.p && a.p.hand.length > 0) {
          this.pendingGive = { fromPid: a.p.pid, toPid: victim.pid };
          this.clearTimer();
          this.setTimer(GIVE_MS, () => this.autoGive());
        }
      } else {
        // wrong card — or right card but a hair too slow: penalty either way,
        // and the attempted card flips up for everyone to see
        const penalty = this.drawFromStock();
        if (!penalty) return this.endRound(null, { lowestTotalOnly: true });
        a.p.hand.push(penalty);
        this.fx('snap-miss', {
          pid: a.p.pid,
          cardId: a.cardId,
          slow: correct,
          shown: { id: found.card.id, r: found.card.r, s: found.card.s },
        });
      }
    }
    if (!winner) {
      // nobody got it — the pile stays open and everyone (including the
      // players who just missed) may try again; a short personal cooldown
      // stops an accidental double-tap from double-penalizing
      const retryAt = Date.now() + 500;
      for (const a of attempts) this.snapCooldownUntil.set(a.p.pid, retryAt);
      this.snapTried.clear();
    }
    this.broadcast();
    this.checkRoundEndBySnap();
  }

  giveCard(p, cardId) {
    if (!this.pendingGive || this.pendingGive.fromPid !== p.pid) return;
    const to = this.playerByPid(this.pendingGive.toPid);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0 || !to) return;
    const card = p.hand.splice(idx, 1)[0];
    to.hand.push(card);
    this.fx('give', { fromPid: p.pid, toPid: to.pid, cardId: card.id });
    this.pendingGive = null;
    this.clearTimer();
    this.broadcast();
    if (p.hand.length === 0) {
      this.fx('empty-hand', {});
      return this.endRound();
    }
    this.resumeAfterGive();
  }

  autoGive() {
    if (!this.pendingGive) return;
    const p = this.playerByPid(this.pendingGive.fromPid);
    if (p && p.hand.length > 0) {
      this.giveCard(p, p.hand[randInt(p.hand.length)].id);
    } else {
      this.pendingGive = null;
      this.broadcast();
      this.resumeAfterGive();
    }
  }

  resumeAfterGive() {
    if (this.phase !== 'play') return;
    if (this.afterGive) {
      const fn = this.afterGive;
      this.afterGive = null;
      fn();
    } else if (this.stage === 'draw' || this.stage === 'decide' || this.stage === 'power') {
      this.setTimer(this.turnMs, () => this.autoPlay());
      this.broadcast();
    }
  }

  checkRoundEndBySnap() {
    if (this.pendingGive) return;
    const empty = this.players.find((p) => p.hand.length === 0);
    if (empty) {
      // running out of cards wins the game on the spot
      this.fx('empty-hand', { pid: empty.pid });
      this.endRound(empty.pid);
    }
  }

  // ---------- showdown ----------
  // The game is a single round: first to empty their hand wins instantly;
  // otherwise lowest total after a cabo call wins (ties go against the
  // caller); a kamikaze hand (2 black kings + 2 face cards) beats everything.

  endRound(forcedWinnerPid = null, options = {}) {
    if (this.phase !== 'play') return;
    const lowestTotalOnly = options.lowestTotalOnly === true;
    this.clearTimer();
    if (this.snapTimer) { clearTimeout(this.snapTimer); this.snapTimer = null; }
    this.phase = 'gameOver';
    this.stage = null;
    this.afterGive = null;
    if (this.drawn) { this.placeOnDiscard(this.drawn.card); this.drawn = null; }
    this.pendingGive = null;

    const caller = this.caboIdx !== null ? this.players[this.caboIdx] : null;
    const rows = this.players.map((p) => ({
      p,
      sum: p.hand.reduce((t, c) => t + cardValue(c), 0),
      kamikaze: isKamikaze(p.hand),
      emptied: forcedWinnerPid === p.pid,
      isCaller: caller === p,
    }));

    // winner order: emptied hand > kamikaze > lowest total.
    // If both stock and discard are exhausted, skip specials and score by total.
    // tie-break on totals: caller loses the tie, then MORE cards wins,
    // and if still equal it's a true tie (shared win)
    let winners = [];
    const special = lowestTotalOnly ? null : rows.find((r) => r.emptied) || rows.find((r) => r.kamikaze);
    if (special) {
      winners = [special];
    } else {
      const sorted = [...rows].sort((a, b) =>
        (a.sum - b.sum) ||
        ((a.isCaller ? 1 : 0) - (b.isCaller ? 1 : 0)) ||
        (b.p.hand.length - a.p.hand.length)
      );
      const best = sorted[0];
      winners = sorted.filter((r) =>
        r.sum === best.sum &&
        r.isCaller === best.isCaller &&
        r.p.hand.length === best.p.hand.length
      );
    }
    this.winnerPids = winners.map((r) => r.p.pid);
    this.winnerPid = this.winnerPids[0];

    this.roundResults = rows.map((r) => ({
      pid: r.p.pid,
      handSum: r.sum,
      isCaller: r.isCaller,
      kamikaze: r.kamikaze,
      emptied: r.emptied,
      caboWon: r.isCaller && this.winnerPid === r.p.pid,
    }));
    this.reveal = {};
    for (const p of this.players) this.reveal[p.pid] = p.hand.map((c) => ({ id: c.id, r: c.r, s: c.s }));

    const durationS = this.startedAt ? Math.round((Date.now() - this.startedAt) / 1000) : 0;
    const winP = this.playerByPid(this.winnerPid);
    console.log(`[stats] game_over code=${this.code} players=${this.players.length} durationS=${durationS} winner=${winP?.isBot ? `bot:${winP.botLevel}` : 'human'}${winners[0].kamikaze ? ' kamikaze' : ''}${winners[0].emptied ? ' emptied' : ''}`);
    this.fx('game-over', {
      pid: this.winnerPid,
      pids: this.winnerPids,
      kamikaze: winners[0].kamikaze,
      emptied: winners[0].emptied,
      tie: this.winnerPids.length > 1,
    });
    this.broadcast();
  }

  // ---------- state ----------

  publicState() {
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      hostPid: this.hostPid(),
      players: this.players.map((p, i) => ({
        pid: p.pid,
        name: p.name,
        avatar: p.avatar,
        connected: p.connected,
        isBot: !!p.isBot,
        botLevel: p.botLevel || null,
        cards: p.hand.map((c) => c.id),
        peeksLeft: this.phase === 'peek' ? p.peeksLeft : 0,
        isTurn: this.phase === 'play' && i === this.turnIdx,
      })),
      stockCount: this.deck.length,
      discard: this.discard.slice(-3).map((c) => ({ id: c.id, r: c.r, s: c.s })),
      turnPid: this.players[this.turnIdx] ? this.players[this.turnIdx].pid : null,
      stage: this.stage,
      drawn: this.drawn ? {
        id: this.drawn.card.id,
        from: this.drawn.from,
        // a card taken from the discard pile is public knowledge
        card: this.drawn.from === 'discard'
          ? { id: this.drawn.card.id, r: this.drawn.card.r, s: this.drawn.card.s }
          : undefined,
      } : null,
      powerKind: this.power ? this.power.kind : null,
      qPeeked: this.power ? this.power.qPeeked : null,
      caboPid: this.caboIdx !== null && this.players[this.caboIdx] ? this.players[this.caboIdx].pid : null,
      snapEpoch: this.snapEpoch,
      snapLocked: !!this.snapLocked,
      turnMs: this.turnMs,
      botSpeed: this.botSpeed,
      pendingGive: this.pendingGive,
      deadline: this.deadline,
      reveal: this.reveal,
      roundResults: this.roundResults,
      winnerPid: this.winnerPid,
      winnerPids: this.winnerPids,
      fxs: this.fxLog.slice(-14),
    };
  }

  // broadcasts are debounced ~10ms: bursts of engine steps (snap resolution,
  // several bots reacting at once) collapse into a single state message
  broadcast() {
    if (this.broadcastPending) return;
    this.broadcastPending = setTimeout(() => {
      this.broadcastPending = null;
      this.flushBroadcast();
    }, 10);
  }

  flushBroadcast() {
    if (this.broadcastPending) { clearTimeout(this.broadcastPending); this.broadcastPending = null; }
    const st = this.publicState();
    this.emit.toRoom('state', st);
    if (this.players.some((p) => p.botBrain)) {
      defer(() => {
        for (const p of this.players) {
          if (p.botBrain) {
            try { p.botBrain.onState(st); } catch (e) { console.error('bot error:', e); }
          }
        }
      });
    }
  }
}

// ---------- room registry ----------

const rooms = new Map();

function createRoom(emitFactory) {
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = new GameRoom(code, emitFactory(code));
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase().trim());
}

function sweepRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty = room.players.every((p) => !p.connected || p.isBot);
    if (empty) {
      if (!room.emptyAt) room.emptyAt = now;
      else if (now - room.emptyAt > 10 * 60 * 1000) {
        room.clearTimer();
        if (room.snapTimer) clearTimeout(room.snapTimer);
        if (room.broadcastPending) clearTimeout(room.broadcastPending);
        clearInterval(room.watchdog);
        for (const p of room.players) if (p.botBrain) p.botBrain.destroy();
        rooms.delete(code);
      }
    } else {
      room.emptyAt = null;
    }
  }
}
// .unref only exists on Node's timer objects — in the browser (offline
// practice mode) setInterval returns a number, so guard it
const sweeper = setInterval(sweepRooms, 60 * 1000);
sweeper.unref?.();

module.exports = { createRoom, getRoom, GameRoom, cardValue, powerOf, MIN_PLAYERS, MAX_PLAYERS };
