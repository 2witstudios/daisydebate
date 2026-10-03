import { z } from 'zod';
import type { SearchParams } from '../access/decision';

/**
 * The mock room's whole state, carried in the address. There is no backend,
 * so each control is a link to the next state; the room page only renders
 * what this model says. The real room (seats, version, ready flags) replaces
 * the reader of this state and nothing else.
 */

type Occupant = 'you' | 'them' | 'empty';
export type JudgeKind = 'person' | 'ai';
export type Lifecycle = 'open' | 'started' | 'closed';
type ViewerRole = 'host' | 'member' | 'outsider';
export type SeatId = 'affirmative' | 'negative' | 'judge';
export type Notice = 'settings-saved' | 'seat-taken' | 'not-ready';

export type RoomState = {
  readonly affirmative: Occupant;
  readonly negative: Occupant;
  /** A person judge; the placeholder AI judge fills the seat itself. */
  readonly judge: Occupant;
  readonly judgeKind: JudgeKind;
  readonly ready: readonly SeatId[];
  readonly lifecycle: Lifecycle;
  /** The ready flags live in Redis: when it is down, readiness is unknown. */
  readonly redisDown: boolean;
  readonly role: ViewerRole;
  /** A finished debate's room, open again with its flags cleared. */
  readonly reopened: boolean;
  readonly notice: Notice | null;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const occupantSchema = z.enum(['you', 'them', 'empty']);
const seatIds = ['affirmative', 'negative', 'judge'] as const;

const readySchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .filter((id): id is SeatId =>
        (seatIds as readonly string[]).includes(id),
      ),
  );

/** The demo rooms: each opens in a different place in a room's life. */
export const presetIds = [
  'created',
  'created-ai',
  'needs-judge',
  'ai-judge',
  'rematch',
  'started',
  'closed',
  'private',
] as const;

/** A room a visitor creates: they host it and no seat is taken yet. */
export const createdState: RoomState = {
  affirmative: 'empty',
  negative: 'empty',
  judge: 'empty',
  judgeKind: 'person',
  ready: [],
  lifecycle: 'open',
  redisDown: false,
  role: 'host',
  reopened: false,
  notice: null,
};

/** The state a room has before any control has been used. */
export const presetFor = (roomId: string): RoomState => {
  switch (roomId) {
    case 'created':
      return createdState;
    case 'created-ai':
      return { ...createdState, judgeKind: 'ai' };
    case 'needs-judge':
      return { ...createdState, affirmative: 'them', role: 'member' };
    case 'ai-judge':
      return {
        ...createdState,
        affirmative: 'them',
        judgeKind: 'ai',
        role: 'member',
      };
    case 'rematch':
      return {
        ...createdState,
        affirmative: 'you',
        negative: 'them',
        judge: 'them',
        reopened: true,
        role: 'member',
      };
    case 'started':
      return {
        ...createdState,
        affirmative: 'you',
        negative: 'them',
        judge: 'them',
        ready: ['affirmative', 'negative', 'judge'],
        lifecycle: 'started',
        role: 'member',
      };
    case 'closed':
      return { ...createdState, lifecycle: 'closed', role: 'member' };
    case 'private':
      return { ...createdState, role: 'outsider' };
    default:
      return { ...createdState, affirmative: 'them', role: 'member' };
  }
};

/** Reads the state from the address, falling back to the room's preset. */
export function parseRoomState(
  roomId: string,
  params: SearchParams,
): RoomState {
  const base = presetFor(roomId);
  const occupant = (key: string, fallback: Occupant): Occupant =>
    occupantSchema.catch(fallback).parse(first(params[key]) ?? fallback);
  const noticeValue = first(params['notice']);
  return {
    affirmative: occupant('aff', base.affirmative),
    negative: occupant('neg', base.negative),
    judge: occupant('judge', base.judge),
    judgeKind: z
      .enum(['person', 'ai'])
      .catch(base.judgeKind)
      .parse(first(params['kind']) ?? base.judgeKind),
    ready:
      first(params['ready']) === undefined
        ? base.ready
        : readySchema.parse(first(params['ready'])),
    lifecycle: z
      .enum(['open', 'started', 'closed'])
      .catch(base.lifecycle)
      .parse(first(params['state']) ?? base.lifecycle),
    redisDown: first(params['redis']) === 'down',
    role: z
      .enum(['host', 'member', 'outsider'])
      .catch(base.role)
      .parse(first(params['as']) ?? base.role),
    reopened:
      first(params['reopened']) === undefined
        ? base.reopened
        : first(params['reopened']) === '1',
    notice:
      noticeValue === 'settings-saved' ||
      noticeValue === 'seat-taken' ||
      noticeValue === 'not-ready'
        ? noticeValue
        : null,
  };
}

/** The address for a state: every field written, so no preset reapplies. */
export function roomHref(roomId: string, state: RoomState): string {
  const params = new URLSearchParams({
    aff: state.affirmative,
    neg: state.negative,
    judge: state.judge,
    kind: state.judgeKind,
    ready: state.ready.join(','),
    state: state.lifecycle,
    as: state.role,
  });
  if (state.redisDown) params.set('redis', 'down');
  if (state.reopened) params.set('reopened', '1');
  if (state.notice) params.set('notice', state.notice);
  return `/rooms/${roomId}?${params.toString()}`;
}

/** Which seat the viewer holds, if any. */
export const mySeat = (state: RoomState): SeatId | null =>
  seatIds.find((seat) => state[seat] === 'you') ?? null;

/** Whether a seat is filled: by a person, or by the AI judge. */
export const filled = (state: RoomState, seat: SeatId): boolean =>
  seat === 'judge' && state.judgeKind === 'ai' ? true : state[seat] !== 'empty';

/** Seats that need a person's ready flag: every filled seat but an AI judge. */
export const needsReady = (state: RoomState, seat: SeatId): boolean =>
  filled(state, seat) && !(seat === 'judge' && state.judgeKind === 'ai');

/** Why the room cannot start yet, or null when it can. */
export function startBlock(state: RoomState): string | null {
  if (state.affirmative === 'empty' || state.negative === 'empty')
    return 'Both debater seats must be filled.';
  if (state.judgeKind === 'person' && state.judge === 'empty')
    return 'A judge must take the judge seat.';
  if (state.redisDown) return 'Ready status is unavailable right now.';
  const waiting = seatIds.filter(
    (seat) => needsReady(state, seat) && !state.ready.includes(seat),
  );
  return waiting.length === 0 ? null : 'Everyone seated must be ready.';
}

/** Any seat or settings change clears every ready flag (the version bump). */
const changed = (state: RoomState, change: Partial<RoomState>): RoomState => ({
  ...state,
  ...change,
  ready: [],
  reopened: false,
  notice: null,
});

export type RoomAction =
  | { readonly kind: 'take'; readonly seat: SeatId }
  | { readonly kind: 'leave' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'judge-kind'; readonly judgeKind: JudgeKind }
  | { readonly kind: 'demo'; readonly what: DemoStep };

/** What the demo controls simulate: other people acting in the room. */
export type DemoStep =
  | 'opponent-joins'
  | 'judge-joins'
  | 'everyone-ready'
  | 'redis-down'
  | 'redis-up';

/** Takes a seat, leaving the one held before. A refused take says why. */
function takeSeat(state: RoomState, seat: SeatId): RoomState {
  if (state.lifecycle !== 'open') return state;
  if (state[seat] !== 'empty' || (seat === 'judge' && state.judgeKind === 'ai'))
    return { ...state, notice: 'seat-taken' };
  const mine = mySeat(state);
  const cleared = mine === null ? state : { ...state, [mine]: 'empty' };
  return changed(cleared, { [seat]: 'you' });
}

/** The viewer's ready flag, flipped. Without a seat, or with Redis down, nothing. */
function toggleReady(state: RoomState): RoomState {
  const mine = mySeat(state);
  if (mine === null || state.redisDown) return state;
  const next = state.ready.includes(mine)
    ? state.ready.filter((seat) => seat !== mine)
    : [...state.ready, mine];
  return { ...state, ready: next, reopened: false, notice: null };
}

/** The state an action leads to. A refused action keeps state and says why. */
export function applyAction(state: RoomState, action: RoomAction): RoomState {
  switch (action.kind) {
    case 'take':
      return takeSeat(state, action.seat);
    case 'leave': {
      const mine = mySeat(state);
      return mine === null ? state : changed(state, { [mine]: 'empty' });
    }
    case 'ready':
      return toggleReady(state);
    case 'judge-kind':
      // Either way the judge seat is empty afterwards: switching to the AI
      // judge removes a person, and switching to a person leaves it open.
      return changed(state, { judgeKind: action.judgeKind, judge: 'empty' });
    case 'demo':
      return demo(state, action.what);
  }
}

function demo(state: RoomState, what: DemoStep): RoomState {
  switch (what) {
    case 'opponent-joins': {
      const seat = state.affirmative === 'empty' ? 'affirmative' : 'negative';
      return state[seat] === 'empty'
        ? changed(state, { [seat]: 'them' })
        : state;
    }
    case 'judge-joins':
      return state.judgeKind === 'person' && state.judge === 'empty'
        ? changed(state, { judge: 'them' })
        : state;
    case 'everyone-ready':
      return {
        ...state,
        ready: seatIds.filter((seat) => needsReady(state, seat)),
        notice: null,
      };
    case 'redis-down':
      return { ...state, redisDown: true };
    case 'redis-up':
      return { ...state, redisDown: false };
  }
}

/** The state after the host saves settings: nothing else changes. */
export const settingsSaved = (state: RoomState): RoomState => ({
  ...state,
  ready: [],
  notice: 'settings-saved',
});
