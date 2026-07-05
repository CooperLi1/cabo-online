'use strict';
// cabo game engine — authoritative server-side rules.
// Rooms hold players, deck state, and a small phase machine:
//   lobby -> peek -> play -> gameOver -> (start again)
// Snap attempts race inside a short grace window and are ordered by
// latency-compensated press time (server arrival minus half the player's RTT).

const crypto = require('crypto');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const SUITS = ['♥', '♦', '♣', '♠'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const MAX_PLAYERS = 10;
const MIN_PLAYERS = 2;

const PEEK_MS = 25000;
const TURN_MS = 45000;
const POWER_MS = 30000;
const GIVE_MS = 15000;
const SNAP_GRACE_MS = 280;
const PEEK_LINGER_MS = 2500;

function rid(n = 8) {
  return crypto.randomBytes(n).toString('base64url');
}

function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}

function buildDeck() {
  const cards = [];
  for (const s of SUITS) for (const r of RANKS) cards.push({ id: rid(6), r, s });
  cards.push({ id: rid(6), r: 'X', s: '★' });
  cards.push({ id: rid(6), r: 'X', s: '★' });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
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
  if (c.r === 'J' || c.r === 'Q') return 'blind-swap';
  if (c.r === 'K' && !isRed(c)) return 'king'; // black kings only
  return null;
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
    this.players = [];
    this.phase = 'lobby';
    this.deck = [];
    this.discard = [];
    this.turnIdx = 0;
    this.stage = null; // 'draw' | 'decide' | 'power' | null
    this.drawn = null; // { card, from: 'stock'|'discard' }
    this.power = null; // { kind, kingPeeked: cardId|null }
    this.caboIdx = null;
    this.round = 0;
    this.snapEpoch = 0;
    this.snapAttempts = [];
    this.snapTried = new Set();
    this.snapTimer = null;
    this.pendingGive = null; // { fromPid, toPid }
    this.timer = null;
    this.deadline = null;
    this.seq = 0;
    this.fxLog = [];
    this.reveal = null;
    this.roundResults = null;
    this.winnerPid = null;
    this.emptyAt = null;
  }

  // ---------- helpers ----------

  playerByToken(t) { return this.players.find((p) => p.token === t); }
  playerByPid(pid) { return this.players.find((p) => p.pid === pid); }
  cur() { return this.players[this.turnIdx]; }

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

  fx(type, data = {}) {
    this.fxLog.push({ type, seq: ++this.seq, ...data });
    if (this.fxLog.length > 10) this.fxLog.shift();
  }

  drawFromStock() {
    if (this.deck.length === 0) {
      // reshuffle discard minus its top card back into the stock
      if (this.discard.length > 1) {
        const top = this.discard.pop();
        this.deck = this.discard;
        this.discard = [top];
        for (let i = this.deck.length - 1; i > 0; i--) {
          const j = crypto.randomInt(i + 1);
          [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
      }
    }
    return this.deck.pop() || null;
  }

  placeOnDiscard(card) {
    this.discard.push(card);
    this.snapEpoch++;
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

  hostPid() {
    const host = this.players.find((p) => p.connected) || this.players[0];
    return host ? host.pid : null;
  }

  // ---------- round setup ----------

  start(byPlayer) {
    if (this.phase !== 'lobby' && this.phase !== 'gameOver') return;
    if (byPlayer.pid !== this.hostPid()) return;
    if (this.players.length < MIN_PLAYERS) return;
    this.winnerPid = null;
    this.round++;
    this.deck = buildDeck();
    this.discard = [];
    this.caboIdx = null;
    this.drawn = null;
    this.power = null;
    this.pendingGive = null;
    this.reveal = null;
    this.roundResults = null;
    for (const p of this.players) {
      p.hand = [];
      p.peeksLeft = 2;
    }
    for (let k = 0; k < 4; k++) for (const p of this.players) p.hand.push(this.deck.pop());
    this.placeOnDiscard(this.deck.pop());
    this.turnIdx = (this.round - 1) % this.players.length;
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
    this.emit.toPlayer(p, 'private', { type: 'peek', card: { id: c.id, r: c.r, s: c.s } });
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
    this.setTimer(TURN_MS, () => this.autoPlay());
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
      if (!c) return this.endRound();
      this.drawn = { card: c, from: 'stock' };
      this.stage = 'decide';
      this.discardDrawn(this.cur(), { auto: true });
    } else if (this.stage === 'decide') {
      if (this.drawn.from === 'discard') {
        // must swap: pick a random own card
        const p = this.cur();
        const target = p.hand[crypto.randomInt(Math.max(p.hand.length, 1))];
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
    if (!c) return this.endRound();
    this.drawn = { card: c, from: 'stock' };
    this.stage = 'decide';
    this.fx('draw', { pid: p.pid, cardId: c.id, from: 'stock' });
    this.emit.toPlayer(p, 'private', { type: 'drawn', card: { id: c.id, r: c.r, s: c.s } });
    this.setTimer(TURN_MS, () => this.autoPlay());
    this.broadcast();
  }

  drawDiscard(p) {
    if (this.phase !== 'play' || this.stage !== 'draw' || this.cur() !== p || this.pendingGive) return;
    if (this.discard.length === 0 || p.hand.length === 0) return;
    const c = this.discard.pop();
    this.drawn = { card: c, from: 'discard' };
    this.stage = 'decide';
    this.fx('draw', { pid: p.pid, cardId: c.id, from: 'discard' });
    this.emit.toPlayer(p, 'private', { type: 'drawn', card: { id: c.id, r: c.r, s: c.s } });
    this.setTimer(TURN_MS, () => this.autoPlay());
    this.broadcast();
  }

  swapDrawn(p, cardId) {
    if (this.phase !== 'play' || this.stage !== 'decide' || this.cur() !== p) return;
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const old = p.hand[idx];
    p.hand[idx] = this.drawn.card;
    this.drawn = null;
    this.placeOnDiscard(old);
    this.fx('swap', { pid: p.pid, outId: old.id, top: { id: old.id, r: old.r, s: old.s } });
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
    if (kind && !opts.auto && p.hand.length > 0) {
      this.stage = 'power';
      this.power = { kind, kingPeeked: null };
      this.setTimer(POWER_MS, () => this.skipPower(p));
      this.broadcast();
    } else {
      this.stage = null;
      this.broadcast();
      this.afterSnapPause(() => this.nextTurn());
    }
  }

  // small pause so a fresh discard is snappable before the next turn begins;
  // snapping stays open after too — this just gives the moment room to breathe
  afterSnapPause(fn) {
    this.setTimer(1100, () => {
      if (this.pendingGive) { this.afterGive = fn; return; }
      fn();
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
      this.emit.toPlayer(p, 'private', {
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
      const tmp = mine.owner.hand[mine.index];
      mine.owner.hand[mine.index] = theirs.owner.hand[theirs.index];
      theirs.owner.hand[theirs.index] = tmp;
      this.fx('blind-swap', { pid: p.pid, aId: payload.aId, bId: payload.bId, targetPid: theirs.owner.pid });
      return done();
    }

    if (kind === 'king') {
      if (!this.power.kingPeeked) {
        const found = this.findCard(payload.cardId);
        if (!found) return;
        this.power.kingPeeked = found.card.id;
        this.emit.toPlayer(p, 'private', {
          type: 'power-peek',
          card: { id: found.card.id, r: found.card.r, s: found.card.s },
          ownerPid: found.owner.pid,
        });
        this.fx('peek', { pid: p.pid, targetPid: found.owner.pid, cardId: found.card.id });
        this.setTimer(POWER_MS, () => this.skipPower(p));
        this.broadcast();
        return;
      }
      // second step: optionally swap peeked card with one of your own
      const target = this.findCard(this.power.kingPeeked);
      const mine = this.findCard(payload.cardId);
      if (!target || !mine || mine.owner !== p || target.owner === p) return;
      const tmp = mine.owner.hand[mine.index];
      mine.owner.hand[mine.index] = target.owner.hand[target.index];
      target.owner.hand[target.index] = tmp;
      this.fx('blind-swap', { pid: p.pid, aId: payload.cardId, bId: this.power.kingPeeked, targetPid: target.owner.pid, king: true });
      return done();
    }
  }

  // ---------- snapping ----------
  // Anyone may snap the top discard at any time during play. Attempts within a
  // short grace window race by estimated press time (arrival - rtt/2).

  snap(p, cardId, rtt = 0) {
    if (this.phase !== 'play' || this.discard.length === 0) return;
    if (this.snapTried.has(p.pid)) return;
    if (this.drawn && this.drawn.card.id === cardId) return;
    const found = this.findCard(cardId);
    if (!found) return;
    this.snapTried.add(p.pid);
    this.snapAttempts.push({
      p, cardId,
      at: Date.now() - Math.min(rtt, 400) / 2,
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
    attempts.sort((a, b) => a.at - b.at);
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
        this.placeOnDiscard(card);
        this.fx('snap-hit', {
          pid: a.p.pid, victimPid: victim.pid, top: { id: card.id, r: card.r, s: card.s },
        });
        if (victim !== a.p && a.p.hand.length > 0) {
          this.pendingGive = { fromPid: a.p.pid, toPid: victim.pid };
          this.clearTimer();
          this.setTimer(GIVE_MS, () => this.autoGive());
        }
      } else {
        // wrong card — or right card but too slow: penalty card either way,
        // and the failed card flips up for everyone to see
        const penalty = this.drawFromStock();
        if (penalty) a.p.hand.push(penalty);
        this.fx('snap-miss', {
          pid: a.p.pid,
          cardId: a.cardId,
          slow: correct,
          shown: { id: found.card.id, r: found.card.r, s: found.card.s },
        });
      }
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
      this.giveCard(p, p.hand[crypto.randomInt(p.hand.length)].id);
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
      this.setTimer(TURN_MS, () => this.autoPlay());
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

  endRound(forcedWinnerPid = null) {
    if (this.phase !== 'play') return;
    this.clearTimer();
    if (this.snapTimer) { clearTimeout(this.snapTimer); this.snapTimer = null; }
    this.phase = 'gameOver';
    this.stage = null;
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

    let winnerRow = rows.find((r) => r.emptied) || rows.find((r) => r.kamikaze);
    if (!winnerRow) {
      winnerRow = [...rows].sort((a, b) =>
        (a.sum - b.sum) ||
        ((a.isCaller ? 1 : 0) - (b.isCaller ? 1 : 0)) || // ties go against the caller
        (a.p.hand.length - b.p.hand.length)
      )[0];
    }
    this.winnerPid = winnerRow.p.pid;

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

    this.fx('game-over', { pid: this.winnerPid, kamikaze: winnerRow.kamikaze, emptied: winnerRow.emptied });
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
        cards: p.hand.map((c) => c.id),
        peeksLeft: this.phase === 'peek' ? p.peeksLeft : 0,
        isTurn: this.phase === 'play' && i === this.turnIdx,
      })),
      stockCount: this.deck.length,
      discard: this.discard.slice(-3).map((c) => ({ id: c.id, r: c.r, s: c.s })),
      turnPid: this.players[this.turnIdx] ? this.players[this.turnIdx].pid : null,
      stage: this.stage,
      drawn: this.drawn ? { id: this.drawn.card.id, from: this.drawn.from } : null,
      powerKind: this.power ? this.power.kind : null,
      kingPeeked: this.power ? this.power.kingPeeked : null,
      caboPid: this.caboIdx !== null && this.players[this.caboIdx] ? this.players[this.caboIdx].pid : null,
      snapEpoch: this.snapEpoch,
      pendingGive: this.pendingGive,
      deadline: this.deadline,
      reveal: this.reveal,
      roundResults: this.roundResults,
      winnerPid: this.winnerPid,
      fxs: this.fxLog.slice(-6),
    };
  }

  broadcast() {
    this.emit.toRoom('state', this.publicState());
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
    const empty = room.players.every((p) => !p.connected);
    if (empty) {
      if (!room.emptyAt) room.emptyAt = now;
      else if (now - room.emptyAt > 10 * 60 * 1000) {
        room.clearTimer();
        if (room.snapTimer) clearTimeout(room.snapTimer);
        rooms.delete(code);
      }
    } else {
      room.emptyAt = null;
    }
  }
}
setInterval(sweepRooms, 60 * 1000).unref();

module.exports = { createRoom, getRoom, GameRoom, cardValue, powerOf, MIN_PLAYERS, MAX_PLAYERS };
