'use client';
// Offline practice mode: runs the SAME game engine that the server uses, but
// inside the browser, wired to a socket.io-shaped shim. No network involved —
// the whole game (bots included) lives in this tab.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GameRoom } = require('./game.js') as { GameRoom: new (code: string, emit: unknown) => LocalRoom };

/* eslint-disable @typescript-eslint/no-explicit-any */
interface LocalRoom {
  players: any[];
  watchdog: ReturnType<typeof setInterval>;
  snapTimer: ReturnType<typeof setTimeout> | null;
  broadcastPending: ReturnType<typeof setTimeout> | null;
  addPlayer(o: { name: string; avatar: string }): any;
  addBot(by: any, level: string): void;
  removeBot(by: any, pid: string): void;
  setTurnMs(by: any, ms: number): void;
  setBotSpeed?(by: any, speed: string): void;
  start(by: any): void;
  peek(p: any, cardId: string): void;
  drawStock(p: any): void;
  drawDiscard(p: any): void;
  swapDrawn(p: any, cardId: string): void;
  discardDrawn(p: any): void;
  usePower(p: any, d: any): void;
  skipPower(p: any): void;
  callCabo(p: any): void;
  giveCard(p: any, cardId: string): void;
  snap(p: any, cardId: string, rtt: number, reaction: number | null): void;
  clearTimer(): void;
  broadcast(): void;
}

type Listener = (payload: unknown) => void;

export class LocalGameSocket {
  connected = true;
  private listeners = new Map<string, Set<Listener>>();
  private room: LocalRoom | null = null;
  private player: any = null;

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }

  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  private dispatch(event: string, payload: unknown) {
    for (const fn of this.listeners.get(event) ?? []) fn(payload);
  }

  emit(event: string, data?: any, cb?: (res: any) => void) {
    const room = this.room;
    const p = this.player;
    switch (event) {
      case 'create': {
        this.destroyRoom();
        const emitFactory = {
          toRoom: (ev: string, payload: unknown) => this.dispatch(ev, payload),
          toPlayer: (target: any, ev: string, payload: unknown) => {
            if (target === this.player) this.dispatch(ev, payload);
          },
        };
        this.room = new GameRoom('SOLO', emitFactory);
        this.player = this.room.addPlayer({ name: data?.name || 'you', avatar: data?.avatar || 'cat' });
        if (typeof data?.turnMs === 'number') this.room.setTurnMs(this.player, data.turnMs);
        cb?.({ ok: true, code: 'SOLO', token: this.player.token, pid: this.player.pid });
        this.room.broadcast();
        return this;
      }
      case 'leave':
        this.destroyRoom();
        return this;
      case 'pingx':
        cb?.(data);
        return this;
      case 'rtt':
        return this;
    }
    if (!room || !p) return this;
    switch (event) {
      case 'addBot': room.addBot(p, data?.level); break;
      case 'removeBot': room.removeBot(p, data?.pid); break;
      case 'setTurnMs': room.setTurnMs(p, data?.turnMs); break;
      case 'setBotSpeed': room.setBotSpeed?.(p, data?.speed); break;
      case 'start': room.start(p); break;
      case 'peek': room.peek(p, data?.cardId); break;
      case 'drawStock': room.drawStock(p); break;
      case 'drawDiscard': room.drawDiscard(p); break;
      case 'swapDrawn': room.swapDrawn(p, data?.cardId); break;
      case 'discardDrawn': room.discardDrawn(p); break;
      case 'usePower': room.usePower(p, data ?? {}); break;
      case 'skipPower': room.skipPower(p); break;
      case 'callCabo': room.callCabo(p); break;
      case 'give': room.giveCard(p, data?.cardId); break;
      case 'snap':
        if (data?.cardId) room.snap(p, data.cardId, 0, typeof data.reaction === 'number' ? data.reaction : null);
        break;
    }
    return this;
  }

  private destroyRoom() {
    const room = this.room;
    if (!room) return;
    room.clearTimer();
    if (room.snapTimer) clearTimeout(room.snapTimer);
    if (room.broadcastPending) clearTimeout(room.broadcastPending);
    clearInterval(room.watchdog);
    for (const q of room.players) q.botBrain?.destroy();
    this.room = null;
    this.player = null;
  }
}
