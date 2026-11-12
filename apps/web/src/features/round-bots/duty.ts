import { assertNever } from '@daisy/protocol';

/** What a turn answers. */
export type Owed =
  /** The speech itself, or the asking seat's first question. */
  | { readonly kind: 'opening' }
  /** One peer turn, named by the server instant that peer last spoke. */
  | {
      readonly kind: 'peer-turn';
      readonly peer: string;
      readonly spokeUntilMs: number;
    }
  /** The asking seat's own question, which met silence. */
  | { readonly kind: 'unanswered' };

/**
 * What a bot seat owes right now. One value: a seat cannot owe a turn and be
 * finished, or be speaking with nothing owed.
 */
export type Duty =
  /**
   * Nothing is owed until a peer's turn ends. `unanswered` is true while the
   * asking seat's last question has met no peer speech, and may be pressed
   * once. `yielded` is what the bot gave way to a peer's speech: that
   * speech ending owes an answer however brief it was, so giving way never
   * loses one.
   */
  | {
      readonly status: 'waiting';
      readonly unanswered: boolean;
      readonly yielded: Yielded | null;
    }
  /**
   * A turn is owed. `paused` after a refusal or a failure: it starts only
   * once the pause is over. A turn that replaces it starts with no pause.
   */
  | ({ readonly status: 'owed'; readonly paused: boolean } & Turn)
  | ({ readonly status: 'speaking' } & Turn)
  /** Nothing more is ever said under this claim. */
  | { readonly status: 'over' };

/** What a waiting bot gave way to a peer's speech. */
export type Yielded =
  /** Its audio: `peer` talked over it, and it answers what they said. */
  | { readonly kind: 'audio'; readonly peer: string }
  /**
   * A turn it had started but bought nothing for, with what it had cost:
   * still owed, at that cost, if the peer said nothing more.
   */
  | ({ readonly kind: 'turn' } & Turn);

/** One owed turn and what it has cost so far. */
type Turn = {
  readonly to: Owed;
  /** Attempts spent on failures. */
  readonly attempts: number;
  /** Refusals and failures in a row with nothing said between: each lengthens the pause. */
  readonly setbacks: number;
};

/** After a setback the turn waits this long... */
const RETRY_FIRST_MS = 200;
/** ...doubling with each one in a row, up to the control pulse's own pace. */
const RETRY_MAX_MS = 3000;
/** How long a paused turn waits before it may start again. */
export const retryPauseMs = (duty: Duty): number =>
  duty.status === 'owed' && duty.paused
    ? Math.min(RETRY_FIRST_MS * 2 ** (duty.setbacks - 1), RETRY_MAX_MS)
    : 0;

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
  /** The pause after a setback is over. */
  | { readonly type: 'pause-ended' }
  /** A phrase was said: the turn is moving again. */
  | { readonly type: 'phrase-said' }
  /** A peer began speaking, or talked over the bot; `audible` is the bot's own audio. */
  | {
      readonly type: 'peer-spoke';
      readonly peer: string;
      readonly audible: boolean;
      /** Whether the running turn has bought anything yet. */
      readonly bought: boolean;
    }
  | {
      readonly type: 'peer-turn-ended';
      readonly peer: string;
      readonly spokeUntilMs: number;
      /** How long that peer's speech in the turn lasted. */
      readonly spokeForMs: number;
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
  /** Wake again after `retryPauseMs`, without waiting for the next pulse. */
  | 'retry-soon'
  /** Start counting the silence after the asking seat's question. */
  | 'await-reply';

type Step = {
  readonly state: SpeakerState;
  readonly effects: readonly DutyEffect[];
};

export const initialSpeakerState = (rules: DutyRules): SpeakerState => ({
  duty: !rules.crossEx || rules.asks ? owe({ kind: 'opening' }) : WAITING,
  midTurn: [],
});

const WAITING: Duty = {
  status: 'waiting',
  unanswered: false,
  yielded: null,
};
const yieldedTo = (yielded: Yielded): Duty => ({
  status: 'waiting',
  unanswered: false,
  yielded,
});
/**
 * Speech shorter than this is not a turn to answer: a cough, a click, a
 * breath. A one-word answer ("yes", "no") runs 300 to 500 ms as heard, first
 * frame to last, so the bound sits inside that range on purpose: the
 * shortest of them are let go rather than every cough answered (DEC-398).
 */
export const BRIEF_TURN_MS = 400;
/** A turn newly owed: nothing spent, nothing to wait for. */
const owe = (to: Owed): Duty => ({
  status: 'owed',
  to,
  attempts: 0,
  setbacks: 0,
  paused: false,
});

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
      if (event.audible)
        return {
          state: {
            duty: yieldedTo({ kind: 'audio', peer: event.peer }),
            midTurn,
          },
          effects: ['cut', 'drop'],
        };
      // The peer has more to say and nothing was bought for what they said
      // so far: the turn stands down, and their turn ending owes the answer.
      // A turn that has bought its answer keeps it and holds its audio.
      return event.bought
        ? { state: { duty, midTurn }, effects: [] }
        : {
            state: {
              duty: yieldedTo({
                kind: 'turn',
                to: duty.to,
                attempts: duty.attempts,
                setbacks: duty.setbacks,
              }),
              midTurn,
            },
            effects: ['restart'],
          };
    case 'waiting':
      // The peer replied (or spoke at all): the question is not unanswered.
      return {
        state: {
          duty: duty.yielded ? yieldedTo(duty.yielded) : WAITING,
          midTurn,
        },
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
  // Too brief to be a turn: the peer is no longer mid-turn, and nothing is
  // owed for it or dropped because of it. What the bot gave way for is the
  // exception: giving way must never lose an answer.
  if (event.spokeForMs < BRIEF_TURN_MS) {
    const yielded = duty.status === 'waiting' ? duty.yielded : null;
    // The turn it stood down from is owed again, at what it had already
    // cost: the peer added nothing.
    if (yielded?.kind === 'turn')
      return {
        state: {
          duty: {
            status: 'owed',
            to: yielded.to,
            attempts: yielded.attempts,
            setbacks: yielded.setbacks,
            paused: false,
          },
          midTurn,
        },
        effects: [],
      };
    // Another peer's brief sound is not what cut the bot off.
    if (yielded?.kind !== 'audio' || yielded.peer !== event.peer)
      return { state: { duty, midTurn }, effects: [] };
  }
  // Turns end in the order they are heard to, not the order they were spoken:
  // an unheard peer's turn ends late. The turn spoken last is the one owed.
  if (
    (duty.status === 'owed' || duty.status === 'speaking') &&
    duty.to.kind === 'peer-turn' &&
    duty.to.spokeUntilMs >= event.spokeUntilMs
  )
    return { state: { duty, midTurn }, effects: [] };
  const owed = owe({
    kind: 'peer-turn',
    peer: event.peer,
    spokeUntilMs: event.spokeUntilMs,
  });
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
        duty: { status: 'waiting', unanswered, yielded: null },
        effects: unanswered ? ['drop', 'await-reply'] : ['drop'],
      };
    }
    case 'deferred':
      return {
        duty: {
          status: 'owed',
          to: duty.to,
          attempts: duty.attempts,
          setbacks: duty.setbacks + 1,
          paused: true,
        },
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
        duty: {
          status: 'owed',
          to: duty.to,
          attempts,
          setbacks: duty.setbacks + 1,
          paused: true,
        },
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
      // A paused turn starts nothing until its pause is over; and in
      // cross-examination nothing starts, or is bought, while a peer is
      // mid-turn: their turn ending may owe a different answer.
      return duty.status === 'owed' &&
        !duty.paused &&
        !(rules.crossEx && midTurn.length > 0)
        ? {
            state: {
              duty: {
                status: 'speaking',
                to: duty.to,
                attempts: duty.attempts,
                setbacks: duty.setbacks,
              },
              midTurn,
            },
            effects: ['start'],
          }
        : { state, effects: [] };
    case 'pause-ended':
      return duty.status === 'owed' && duty.paused
        ? { state: { duty: { ...duty, paused: false }, midTurn }, effects: [] }
        : { state, effects: [] };
    case 'phrase-said':
      return duty.status === 'speaking' && duty.setbacks > 0
        ? { state: { duty: { ...duty, setbacks: 0 }, midTurn }, effects: [] }
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
              duty: owe({ kind: 'unanswered' }),
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
