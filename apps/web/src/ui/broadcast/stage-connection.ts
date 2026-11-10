import type { StageLink } from './stage-view';

/** What the stage needs of a vendor room; LiveKit's Room satisfies it. */
export type StageRoomHandle = {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
};

/** The one media room the stage holds, as one value, so a room and its link cannot disagree. */
export type StageConnection<R> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'joining'; readonly room: R }
  | { readonly kind: 'joined'; readonly room: R; readonly resuming: boolean }
  | { readonly kind: 'closed' };

/** Each event names its room, so a room the stage already let go cannot move the current one. */
export type StageConnectionEvent<R> =
  | { readonly type: 'join'; readonly room: R }
  | { readonly type: 'joined'; readonly room: R }
  | { readonly type: 'failed'; readonly room: R }
  | { readonly type: 'resuming'; readonly room: R }
  | { readonly type: 'resumed'; readonly room: R }
  | { readonly type: 'dropped'; readonly room: R }
  | { readonly type: 'close' };

type StageConnectionEffect<R> = {
  readonly type: 'disconnect';
  readonly room: R;
};

type Step<R> = {
  readonly state: StageConnection<R>;
  readonly effects: readonly StageConnectionEffect<R>[];
};

export const stageConnectionIdle: StageConnection<never> = { kind: 'idle' };

const stay = <R>(state: StageConnection<R>): Step<R> => ({
  state,
  effects: [],
});
const release = <R>(state: StageConnection<R>, room: R): Step<R> => ({
  state,
  effects: [{ type: 'disconnect', room }],
});

type RoomEvent<R> = Exclude<StageConnectionEvent<R>, { type: 'close' }>;

/** How an event from the room the stage holds moves it. */
const heldRoomMoves: {
  readonly [K in RoomEvent<unknown>['type']]: <R>(
    state: Exclude<StageConnection<R>, { kind: 'idle' | 'closed' }>,
  ) => Step<R>;
} = {
  join: (state) => stay(state),
  joined: (state) =>
    stay(
      state.kind === 'joining'
        ? { kind: 'joined', room: state.room, resuming: false }
        : state,
    ),
  failed: (state) => release(stageConnectionIdle, state.room),
  resuming: (state) =>
    stay(state.kind === 'joined' ? { ...state, resuming: true } : state),
  resumed: (state) =>
    stay(state.kind === 'joined' ? { ...state, resuming: false } : state),
  dropped: () => stay(stageConnectionIdle),
};

/** A room the stage does not hold: only a join from no room takes it, and one that connected or failed is let go. */
const otherRoomMove = <R>(
  state: StageConnection<R>,
  event: RoomEvent<R>,
): Step<R> => {
  if (event.type === 'join' && state.kind === 'idle')
    return stay({ kind: 'joining', room: event.room });
  return event.type === 'join' ||
    event.type === 'joined' ||
    event.type === 'failed'
    ? release(state, event.room)
    : stay(state);
};

/**
 * The stage's connection, one event at a time. Only a stage with no room joins one; a
 * connect that fails lets its room go, so the next read joins afresh. A room the stage
 * does not hold is disconnected if it answers, and nothing reopens a closed stage.
 */
export const stageConnectionOn = <R>(
  state: StageConnection<R>,
  event: StageConnectionEvent<R>,
): Step<R> => {
  if (event.type === 'close')
    return state.kind === 'joining' || state.kind === 'joined'
      ? release({ kind: 'closed' }, state.room)
      : stay({ kind: 'closed' });
  return (state.kind === 'joining' || state.kind === 'joined') &&
    state.room === event.room
    ? heldRoomMoves[event.type](state)
    : otherRoomMove(state, event);
};

/** Only a settled room shows the debate; anything else is a gap on the video. */
export const stageLinkOf = (state: StageConnection<unknown>): StageLink =>
  state.kind === 'joined' && !state.resuming ? 'connected' : 'reconnecting';
