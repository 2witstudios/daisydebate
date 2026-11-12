import { assertNever } from '@daisy/protocol';

/** What a turn answers. */
export type Owed =
  /** The speech itself, or the asking seat's first question. */
  | { readonly kind: 'opening' }
  /** One peer turn, named by the server instant that peer last spoke. */
  | { readonly kind: 'peer-turn'; readonly spokeUntilMs: number }
  /** The asking seat's own question, which met silence. */
  | { readonly kind: 'unanswered' };

/**
 * What a bot seat owes right now. One value: a seat cannot owe a turn and be
 * finished, or be speaking with nothing owed.
 */
export type Duty =
  /**
   * Nothing is owed until a peer's turn ends. `unanswered` is true while the
   * asking seat's last question has met no peer speech, and may be pressed once.
   */
  | { readonly status: 'waiting'; readonly unanswered: boolean }
  | { readonly status: 'owed'; readonly to: Owed; readonly attempts: number }
  | {
      readonly status: 'speaking';
      readonly to: Owed;
      readonly attempts: number;
    }
  /** Nothing more is ever said under this claim. */
  | { readonly status: 'over' };

export type SpeakerState = {
  readonly duty: Duty;
  /** The peers between their speech starting and their turn ending. */
  readonly midTurn: readonly string[];
};

export type DutyRules = {
  readonly crossEx: boolean;
  /** This seat's side asks in the cross-examination. */
  readonly asks: boolean;
  readonly maxAttempts: number;
};

export type DutyEvent =
  | { readonly type: 'woke' }
  /** A peer began speaking, or talked over the bot; `audible` is the bot's own audio. */
  | {
      readonly type: 'peer-spoke';
      readonly peer: string;
      readonly audible: boolean;
    }
  | {
      readonly type: 'peer-turn-ended';
      readonly peer: string;
      readonly spokeUntilMs: number;
    }
  /** The asking seat's question has met silence for long enough. */
  | { readonly type: 'silence-elapsed' }
  | { readonly type: 'delivered' }
  /** A refusal that can clear; `authorityChanged` when what was prepared no longer fits. */
  | { readonly type: 'deferred'; readonly authorityChanged: boolean }
  /** An attempt was spent; `unusable` when the answer bought cannot be said. */
  | { readonly type: 'failed'; readonly unusable: boolean }
  | { readonly type: 'refused-for-good' }
  | { readonly type: 'stopped' };

/** What the speaker must do for a transition, in order. */
export type DutyEffect =
  /** Begin the turn now owed. */
  | 'start'
  /** Stop the running turn and clear its audio at once. */
  | 'cut'
  /** Stop the running turn: a newer one is owed, or the claim is ending. */
  | 'restart'
  /** Forget what was prepared or bought for the turn. */
  | 'drop'
  /** Clear audio still queued from a turn already delivered. */
  | 'silence'
  /** Wake again shortly, without waiting for the next pulse. */
  | 'retry-soon'
  /** Start counting the silence after the asking seat's question. */
  | 'await-reply';

type Step = {
  readonly state: SpeakerState;
  readonly effects: readonly DutyEffect[];
};

export const initialSpeakerState = (rules: DutyRules): SpeakerState => ({
  duty:
    !rules.crossEx || rules.asks
      ? { status: 'owed', to: { kind: 'opening' }, attempts: 0 }
      : { status: 'waiting', unanswered: false },
  midTurn: [],
});

const WAITING: Duty = { status: 'waiting', unanswered: false };

/** A peer speaking over audible bot audio cuts it; otherwise nothing is thrown away. */
function peerSpoke(
  state: SpeakerState,
  event: Extract<DutyEvent, { type: 'peer-spoke' }>,
  rules: DutyRules,
): Step {
  if (!rules.crossEx) return { state, effects: [] };
  const midTurn = state.midTurn.includes(event.peer)
    ? state.midTurn
    : [...state.midTurn, event.peer];
  const { duty } = state;
  switch (duty.status) {
    case 'speaking':
      // Talked over: the bot stops and waits for that peer's turn to end.
      return event.audible
        ? { state: { duty: WAITING, midTurn }, effects: ['cut', 'drop'] }
        : { state: { duty, midTurn }, effects: [] };
    case 'waiting':
      // The peer replied (or spoke at all): the question is not unanswered.
      return {
        state: { duty: WAITING, midTurn },
        effects: event.audible ? ['silence'] : [],
      };
    case 'owed':
    case 'over':
      return {
        state: { duty, midTurn },
        effects: event.audible ? ['silence'] : [],
      };
    default:
      return assertNever(duty);
  }
}

/** Each ended peer turn is owed one answer; a newer one replaces an older. */
function peerTurnEnded(
  state: SpeakerState,
  event: Extract<DutyEvent, { type: 'peer-turn-ended' }>,
  rules: DutyRules,
): Step {
  if (!rules.crossEx) return { state, effects: [] };
  const midTurn = state.midTurn.filter((peer) => peer !== event.peer);
  const { duty } = state;
  if (duty.status === 'over') return { state: { duty, midTurn }, effects: [] };
  const owed: Duty = {
    status: 'owed',
    to: { kind: 'peer-turn', spokeUntilMs: event.spokeUntilMs },
    attempts: 0,
  };
  return {
    state: { duty: owed, midTurn },
    effects: duty.status === 'speaking' ? ['restart'] : ['drop'],
  };
}

/** The duty after its running turn ended some way. */
function turnEnded(
  duty: Extract<Duty, { status: 'speaking' }>,
  event: Extract<
    DutyEvent,
    { type: 'delivered' | 'deferred' | 'failed' | 'refused-for-good' }
  >,
  rules: DutyRules,
): { readonly duty: Duty; readonly effects: readonly DutyEffect[] } {
  switch (event.type) {
    case 'delivered': {
      if (!rules.crossEx)
        return { duty: { status: 'over' }, effects: ['drop'] };
      // A question may be pressed once: never the pressing itself.
      const unanswered = rules.asks && duty.to.kind !== 'unanswered';
      return {
        duty: { status: 'waiting', unanswered },
        effects: unanswered ? ['drop', 'await-reply'] : ['drop'],
      };
    }
    case 'deferred':
      return {
        duty: { status: 'owed', to: duty.to, attempts: duty.attempts },
        effects:
          // A cross-examination answer belongs to the authority it was made under.
          event.authorityChanged && rules.crossEx
            ? ['drop', 'retry-soon']
            : ['retry-soon'],
      };
    case 'failed': {
      const attempts = duty.attempts + 1;
      if (attempts >= rules.maxAttempts)
        // This turn is spent. A later peer turn is owed afresh; a speech is over.
        return {
          duty: rules.crossEx ? WAITING : { status: 'over' },
          effects: ['drop'],
        };
      return {
        duty: { status: 'owed', to: duty.to, attempts },
        effects: event.unusable ? ['drop', 'retry-soon'] : ['retry-soon'],
      };
    }
    case 'refused-for-good':
      return { duty: { status: 'over' }, effects: ['drop'] };
    default:
      return assertNever(event);
  }
}

/** Pure and total: every event in every state has one answer. */
export function nextSpeakerState(
  state: SpeakerState,
  event: DutyEvent,
  rules: DutyRules,
): Step {
  const { duty, midTurn } = state;
  switch (event.type) {
    case 'woke':
      return duty.status === 'owed'
        ? {
            state: { duty: { ...duty, status: 'speaking' }, midTurn },
            effects: ['start'],
          }
        : { state, effects: [] };
    case 'peer-spoke':
      return peerSpoke(state, event, rules);
    case 'peer-turn-ended':
      return peerTurnEnded(state, event, rules);
    case 'silence-elapsed':
      return duty.status === 'waiting' &&
        duty.unanswered &&
        midTurn.length === 0
        ? {
            state: {
              duty: { status: 'owed', to: { kind: 'unanswered' }, attempts: 0 },
              midTurn,
            },
            effects: [],
          }
        : { state, effects: [] };
    case 'delivered':
    case 'deferred':
    case 'failed':
    case 'refused-for-good': {
      // A turn already replaced or cut has no say over the duty that replaced it.
      if (duty.status !== 'speaking') return { state, effects: [] };
      const ended = turnEnded(duty, event, rules);
      return { state: { duty: ended.duty, midTurn }, effects: ended.effects };
    }
    case 'stopped':
      return {
        state: { duty: { status: 'over' }, midTurn },
        effects: duty.status === 'speaking' ? ['restart', 'drop'] : ['drop'],
      };
    default:
      return assertNever(event);
  }
}
