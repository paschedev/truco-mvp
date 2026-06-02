export interface User {
  id: string;
  username: string;
  email?: string;
  coins?: number;
  wins?: number;
  losses?: number;
  avatarUrl?: string;
  verified?: boolean;
}

export interface CardPlay {
  userId: string;
  card: string;
  orderInTrick?: number;
}

export interface Score {
  [playerId: string]: number;
}

export interface EnvidoState {
  calls: string[];
  pending: boolean;
  caller: string | null;
}

export interface TrucoState {
  level: number;
  pending: boolean;
  caller: string | null;
  acceptedBy: string | null;
  canRaiseBy: string | null;
}

export interface EnvidoStep {
  playerId: string;
  type: 'points' | 'good';
  value: number | string;
}

export interface LastAction {
  type: 'envido' | 'truco' | 'fold';
  winner: string;
  points: number;
  accepted?: boolean;
  winnerPoints?: number | null;
  envidoPoints?: Record<string, number>;
  envidoSpoken?: Record<string, string | number>;
  envidoSteps?: EnvidoStep[];
  resolutionId?: number;
}

export interface ResponseBubble {
  playerId: string;
  text: string;
  id: number;
}

export interface GameState {
  id: string;
  players: string[];
  turnOrder: string[];
  hands: Record<string, string[]>;
  initialHands: Record<string, string[]>;
  table: CardPlay[];
  currentTrick: CardPlay[];
  history: string[];
  turn: string;
  mano: string;
  winner: string | null;
  firstCardPlayed: Record<string, boolean>;
  score: Score;
  matchWinner: string | null;
  envido: EnvidoState | null;
  envidoPlayed: boolean;
  truco: TrucoState;
  lastAction: LastAction | null;
  responseBubble: ResponseBubble | null;
}
