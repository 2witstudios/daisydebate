/**
 * The AI debate timeline: a strict IPDA round between a person and an AI,
 * folded from an append-only command log and an injected time. Pure: no
 * clock, ids or I/O. Turns advance by time. Before each of the person's own
 * speeches (except the opening one) their prep clock runs until they start
 * the speech or the prep runs out; the AI never preps. Every other turn
 * opens with a short countdown, so nobody is caught mid-breath. Either side
 * may yield a live turn early, and the next one's countdown begins then.
 */
export type AiDebateSide = 'affirmative' | 'negative';
export type AiDebateRole = 'person' | 'ai';

export type AiDebateTurn = {
  readonly index: number;
  /** The IPDA name: AC, CX, NC, 1AR, NR, 2AR. */
  readonly name: string;
  readonly label: string;
  readonly kind: 'speech' | 'cross-examination';
  /** The speaking side, or for cross-examination the asking side. */
  readonly side: AiDebateSide;
  readonly durationMs: number;
};

const turn = (
  index: number,
  name: string,
  label: string,
  kind: AiDebateTurn['kind'],
  side: AiDebateSide,
  minutes: number,
): AiDebateTurn => ({
  index,
  name,
  label,
  kind,
  side,
  durationMs: minutes * 60_000,
});

export const ipdaTurns: readonly AiDebateTurn[] = [
  turn(0, 'AC', 'Affirmative constructive', 'speech', 'affirmative', 5),
  turn(
    1,
    'CX',
    'Cross-examination of the affirmative',
    'cross-examination',
    'negative',
    3,
  ),
  turn(2, 'NC', 'Negative constructive', 'speech', 'negative', 6),
  turn(
    3,
    'CX',
    'Cross-examination of the negative',
    'cross-examination',
    'affirmative',
    3,
  ),
  turn(4, '1AR', 'First affirmative rebuttal', 'speech', 'affirmative', 5),
  turn(5, 'NR', 'Negative rebuttal', 'speech', 'negative', 5),
  turn(6, '2AR', 'Second affirmative rebuttal', 'speech', 'affirmative', 3),
];

/** The person's elective prep budget; the AI takes none. */
export const ipdaPrepMs = 240_000;

/** The countdown into each turn that has no prep before it. */
export const ipdaCountdownMs = 10_000;

const other = (side: AiDebateSide): AiDebateSide =>
  side === 'affirmative' ? 'negative' : 'affirmative';

/** Who speaks a turn, and for cross-examination who asks and who answers. */
export function turnRoles(
  turn: AiDebateTurn,
  personSide: AiDebateSide,
): { speaker: AiDebateRole; asker?: AiDebateRole; answerer?: AiDebateRole } {
  const roleOf = (side: AiDebateSide): AiDebateRole =>
    side === personSide ? 'person' : 'ai';
  if (turn.kind === 'speech') return { speaker: roleOf(turn.side) };
  return {
    speaker: roleOf(turn.side),
    asker: roleOf(turn.side),
    answerer: roleOf(other(turn.side)),
  };
}

type AiDebateAbortReason = 'person' | 'vendor-failure';

export type AiDebateCommand =
  | { readonly type: 'start'; readonly at: number }
  | { readonly type: 'startSpeech'; readonly at: number }
  | { readonly type: 'yield'; readonly at: number; readonly turnIndex: number }
  | {
      readonly type: 'abort';
      readonly at: number;
      readonly reason: AiDebateAbortReason;
    };

export type AiDebateState =
  | { readonly phase: 'waiting' }
  | {
      readonly phase: 'countdown';
      readonly turnIndex: number;
      readonly startsAt: number;
      readonly remainingMs: number;
      readonly prepLeftMs: number;
    }
  | {
      readonly phase: 'prep';
      readonly turnIndex: number;
      readonly prepStartedAt: number;
      readonly prepLeftMs: number;
    }
  | {
      readonly phase: 'live';
      readonly turnIndex: number;
      readonly startedAt: number;
      readonly endsAt: number;
      readonly remainingMs: number;
      readonly prepLeftMs: number;
    }
  | { readonly phase: 'ended'; readonly endedAt: number }
  | {
      readonly phase: 'aborted';
      readonly at: number;
      readonly reason: AiDebateAbortReason;
    };

const isPrepGate = (turn: AiDebateTurn, personSide: AiDebateSide) =>
  turn.index > 0 &&
  turn.kind === 'speech' &&
  turnRoles(turn, personSide).speaker === 'person';

type Gap = {
  readonly turn: AiDebateTurn;
  readonly prepped: boolean;
  readonly cursor: number;
  readonly turnStart: number;
  /** Prep left as the gap opens. */
  readonly prepLeft: number;
  /** Prep left once the turn starts. */
  readonly prepAfter: number;
};

/** The gap before a turn: the person's elective prep, or a countdown. */
function gapBefore(
  turn: AiDebateTurn,
  personSide: AiDebateSide,
  cursor: number,
  prepLeft: number,
  speechStarts: readonly number[],
  countdownMs: number,
): Gap {
  if (!isPrepGate(turn, personSide))
    return {
      turn,
      prepped: false,
      cursor,
      turnStart: cursor + countdownMs,
      prepLeft,
      prepAfter: prepLeft,
    };
  const deadline = cursor + prepLeft;
  const turnStart =
    speechStarts.find((at) => at >= cursor && at < deadline) ?? deadline;
  return {
    turn,
    prepped: true,
    cursor,
    turnStart,
    prepLeft,
    prepAfter: prepLeft - (turnStart - cursor),
  };
}

/** The state while `now` falls inside a gap. */
function inGap(gap: Gap, now: number): AiDebateState {
  if (gap.prepped)
    return {
      phase: 'prep',
      turnIndex: gap.turn.index,
      prepStartedAt: gap.cursor,
      prepLeftMs: gap.prepLeft - (now - gap.cursor),
    };
  return {
    phase: 'countdown',
    turnIndex: gap.turn.index,
    startsAt: gap.turnStart,
    remainingMs: gap.turnStart - now,
    prepLeftMs: gap.prepLeft,
  };
}

/** When a turn ends: at its length, or earlier at a yield inside it. */
function turnEndFor(
  turn: AiDebateTurn,
  turnStart: number,
  seen: readonly AiDebateCommand[],
) {
  const plannedEnd = turnStart + turn.durationMs;
  const early = seen.find(
    (command) =>
      command.type === 'yield' &&
      command.turnIndex === turn.index &&
      command.at >= turnStart &&
      command.at < plannedEnd,
  );
  return early ? early.at : plannedEnd;
}

/**
 * The state at `now`, from the commands at or before it. Commands are
 * assumed accepted (see `acceptAiDebateCommand`); the fold reads each in
 * order and never throws.
 */
export function deriveAiDebate({
  personSide,
  commands,
  now,
  turns = ipdaTurns,
  prepMs = ipdaPrepMs,
  countdownMs = ipdaCountdownMs,
}: {
  readonly personSide: AiDebateSide;
  readonly commands: readonly AiDebateCommand[];
  readonly now: number;
  readonly turns?: readonly AiDebateTurn[];
  readonly prepMs?: number;
  readonly countdownMs?: number;
}): AiDebateState {
  const seen = commands.filter((command) => command.at <= now);
  const started = seen.find((command) => command.type === 'start');
  if (!started) return { phase: 'waiting' };
  const abort = seen.find((command) => command.type === 'abort');
  if (abort?.type === 'abort')
    return { phase: 'aborted', at: abort.at, reason: abort.reason };
  const speechStarts = seen
    .filter((command) => command.type === 'startSpeech')
    .map((command) => command.at);
  let cursor = started.at;
  let prepLeft = prepMs;
  for (const turn of turns) {
    const gap = gapBefore(
      turn,
      personSide,
      cursor,
      prepLeft,
      speechStarts,
      countdownMs,
    );
    if (now < gap.turnStart) return inGap(gap, now);
    const turnStart = gap.turnStart;
    prepLeft = gap.prepAfter;
    const turnEnd = turnEndFor(turn, turnStart, seen);
    if (now < turnEnd)
      return {
        phase: 'live',
        turnIndex: turn.index,
        startedAt: turnStart,
        endsAt: turnEnd,
        remainingMs: turnEnd - now,
        prepLeftMs: prepLeft,
      };
    cursor = turnEnd;
  }
  return { phase: 'ended', endedAt: cursor };
}

type AiDebateRefusal =
  | 'already-started'
  | 'not-started'
  | 'out-of-order'
  | 'not-in-prep'
  | 'turn-not-live'
  | 'finished';

type Verdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: AiDebateRefusal };

const allow: Verdict = { ok: true };
const refuse = (reason: AiDebateRefusal): Verdict => ({ ok: false, reason });

/** Whether a command fits the state it would apply to. */
function fitsState(command: AiDebateCommand, state: AiDebateState): Verdict {
  if (state.phase === 'ended' || state.phase === 'aborted')
    return refuse('finished');
  if (command.type === 'startSpeech')
    return state.phase === 'prep' ? allow : refuse('not-in-prep');
  if (command.type === 'yield')
    return state.phase === 'live' && state.turnIndex === command.turnIndex
      ? allow
      : refuse('turn-not-live');
  return allow;
}

/**
 * Whether `command` may be appended to `commands`. A refused command leaves
 * the log, and so the state, unchanged.
 */
export function acceptAiDebateCommand({
  personSide,
  commands,
  command,
}: {
  readonly personSide: AiDebateSide;
  readonly commands: readonly AiDebateCommand[];
  readonly command: AiDebateCommand;
}): Verdict {
  if (command.type === 'start')
    return commands.length === 0 ? allow : refuse('already-started');
  const last = commands.at(-1);
  if (!last) return refuse('not-started');
  if (command.at < last.at) return refuse('out-of-order');
  return fitsState(
    command,
    deriveAiDebate({ personSide, commands, now: command.at }),
  );
}

/**
 * An upper bound on when the debate ends if nobody yields or starts early:
 * every turn, a countdown before each, and the person's whole prep budget.
 * Used to count live debates.
 */
export const aiDebateLongestMs = (
  turns: readonly AiDebateTurn[] = ipdaTurns,
  prepMs = ipdaPrepMs,
  countdownMs = ipdaCountdownMs,
) =>
  turns.reduce((sum, turn) => sum + turn.durationMs + countdownMs, 0) + prepMs;
