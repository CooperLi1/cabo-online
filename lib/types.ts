export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'X';

export interface CardInfo {
  id: string;
  r: Rank;
  s: string;
}

export interface PlayerState {
  pid: string;
  name: string;
  avatar: string;
  connected: boolean;
  isBot?: boolean;
  botLevel?: 'easy' | 'medium' | 'expert' | null;
  cards: string[]; // card ids only — values stay secret on the server
  peeksLeft: number;
  isTurn: boolean;
}

export interface RoundResult {
  pid: string;
  handSum: number;
  isCaller: boolean;
  kamikaze: boolean;
  emptied: boolean;
  caboWon: boolean;
}

export interface Fx {
  type: string;
  seq: number;
  pid?: string;
  victimPid?: string;
  targetPid?: string;
  fromPid?: string;
  toPid?: string;
  cardId?: string;
  aId?: string;
  bId?: string;
  from?: string;
  queen?: boolean;
  power?: string | null;
  top?: CardInfo;
  shown?: CardInfo;
  slow?: boolean;
  kamikaze?: boolean;
  emptied?: boolean;
  tie?: boolean;
  pids?: string[];
  round?: number;
}

export interface GameState {
  code: string;
  phase: 'lobby' | 'peek' | 'play' | 'gameOver';
  round: number;
  hostPid: string | null;
  players: PlayerState[];
  stockCount: number;
  discard: CardInfo[]; // top few cards, last = top of pile
  turnPid: string | null;
  stage: 'draw' | 'decide' | 'power' | null;
  drawn: { id: string; from: 'stock' | 'discard'; card?: CardInfo } | null;
  powerKind: 'peek-own' | 'peek-other' | 'blind-swap' | 'peek-swap' | null;
  qPeeked: string | null;
  caboPid: string | null;
  snapEpoch: number;
  snapLocked: boolean;
  turnMs: number;
  pendingGive: { fromPid: string; toPid: string } | null;
  deadline: number | null;
  reveal: Record<string, CardInfo[]> | null;
  roundResults: RoundResult[] | null;
  winnerPid: string | null;
  winnerPids: string[];
  fxs: Fx[];
}

export interface PrivateMsg {
  type: 'peek' | 'drawn' | 'power-peek';
  card: CardInfo;
  ownerPid?: string;
}

export function isRed(c: { s: string }): boolean {
  return c.s === '♥' || c.s === '♦';
}

export function cardValue(c: { r: Rank; s: string }): number {
  if (c.r === 'X') return 0;
  if (c.r === 'K') return isRed(c) ? -1 : 25;
  if (c.r === 'Q') return 12;
  if (c.r === 'J') return 11;
  if (c.r === 'A') return 1;
  return parseInt(c.r, 10);
}
