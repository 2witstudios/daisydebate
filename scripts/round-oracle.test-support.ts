import { catalogFormats } from '@daisy/db/catalog-formats';
import {
  foundationDefinition,
  foundationSettings,
  oneOnOneDefinition,
  oneOnOneSettings,
} from '@daisy/db/reference-formats';
import {
  createRoundRuntime,
  resolveRoomConfiguration,
} from '@daisy/debate-engine';
import { isAppError } from '@daisy/errors';
import {
  daisyBallotSource,
  daisyWinnerBallot,
  emptyRuntimeCheckpointFor,
  everySeatOf,
  isJudgeSeat,
  leadSeatOf,
  sameSeat,
  type FormatDefinition,
  type FormatSettings,
  type HydratedSegment,
  type RoundLifecycle,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundProjection,
  type RoundRules,
  type RoundStage,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import { invariantIdOf } from './invariant-error';

/**
 * The round engine's oracle (ADR 0161). It knows only the public
 * `RoundRuntime` and the durable rows a caller writes from its projections:
 * every check reads the rules, the rows and the derived position, never the
 * engine's own legality code, so a rewrite (R4.1) is held to the same
 * answers.
 */

type Runtime = ReturnType<typeof createRoundRuntime>;

/** One format the walks run, under one of its settings variants. */
export type OracleFormat = {
  readonly name: string;
  readonly rules: RoundRules;
};

const withSettings = (
  base: FormatSettings,
): readonly (readonly [string, FormatSettings])[] => [
  ['preset', base],
  ['no in-round prep', { ...base, inRoundPrep: { enabled: false } }],
  [
    'interruptions',
    {
      ...base,
      interruptions: { mode: 'enabled', minRemainingMs: 30_000 },
      yielding: { allowed: true, returnsTime: true },
    },
  ],
  [
    'no countdown',
    { ...base, speechTiming: { ...base.speechTiming, countdownMs: 0 } },
  ],
];

/**
 * Every catalogue and reference format, each under its preset and the
 * variants its definition accepts. A variant the format refuses is not a
 * Round anyone can play, so it is left out.
 */
export const oracleFormats = (): readonly OracleFormat[] => {
  const sources: readonly (readonly [
    string,
    FormatDefinition,
    FormatSettings,
  ])[] = [
    ['reference one-on-one', oneOnOneDefinition, oneOnOneSettings],
    ['reference foundation', foundationDefinition, foundationSettings],
    ...catalogFormats.map(
      (format) => [format.id, format.definition, format.preset] as const,
    ),
  ];
  return sources.flatMap(([id, definition, preset]) =>
    withSettings(preset).flatMap(([variant, settings]) => {
      const outcome = resolveRoomConfiguration(definition, settings);
      if (outcome.ok)
        return [{ name: `${id} (${variant})`, rules: outcome.rules }];
      if (variant === 'preset')
        throw new Error(`${id} preset refused: ${outcome.refusal.message}`);
      return [];
    }),
  );
};

/** One actor per declared seat, ids fixed so a failing walk replays. */
export const castOf = (rules: RoundRules): readonly RoundParticipantSeat[] =>
  everySeatOf(rules).map((seat, index) => ({
    id: `seat${String(index).padStart(20, '0')}`,
    actorId: `actor${String(index).padStart(19, '0')}`,
    seat,
  }));

/** The durable state a caller holds: the Round row and its segment rows. */
export type Persisted = {
  readonly lifecycle: RoundLifecycle;
  readonly currentStage: RoundStage | null;
  readonly checkpoint: RuntimeCheckpoint;
  readonly segments: readonly HydratedSegment[];
};

export const openingRound = (rules: RoundRules): Persisted => ({
  lifecycle: {
    status: 'opening',
    startedAt: null,
    completedAt: null,
    outcome: null,
  },
  currentStage: null,
  checkpoint: emptyRuntimeCheckpointFor(rules),
  segments: [],
});

/** Writes a projection the way a caller does: its round block, then its rows. */
export const persist = (
  before: Persisted,
  projection: RoundProjection,
): Persisted => {
  const closes = new Map(
    projection.segmentCloses.map((close) => [close.id, close.endedAt]),
  );
  const returns = new Map(
    (projection.segmentReturns ?? []).map((row) => [row.id, row.returnedMs]),
  );
  const segments = [
    ...before.segments,
    ...projection.segmentInserts.map((row): HydratedSegment => ({
      ...row,
      endedAt: null,
      returnedMs: 0,
    })),
  ].map((row) => ({
    ...row,
    endedAt: closes.get(row.id) ?? row.endedAt,
    returnedMs: returns.get(row.id) ?? row.returnedMs,
  }));
  if (projection.round === null) return { ...before, segments };
  const { currentStage, checkpoint, ...lifecycle } = projection.round;
  return { lifecycle, currentStage, checkpoint, segments };
};

/** A runtime hydrated from durable rows alone, as every production caller makes one. */
export const hydrate = (
  rules: RoundRules,
  participants: readonly RoundParticipantSeat[],
  rows: Persisted,
  mint = 0,
): Runtime => {
  let next = mint;
  return createRoundRuntime({
    round: {
      id: 'round00000000000000000000',
      ...rows.lifecycle,
      currentStage: rows.currentStage,
    },
    rules,
    participants,
    checkpoint: rows.checkpoint,
    segments: rows.segments,
    nextSegmentId: () => {
      next += 1;
      return `row${String(next).padStart(21, '0')}`;
    },
  });
};

/** What a refusal was: its registered invariant id, an app error's code, or a stray throw. */
export type Refusal =
  | { readonly kind: 'invariant'; readonly id: string }
  | { readonly kind: 'app'; readonly code: string }
  | { readonly kind: 'stray'; readonly error: string };

export const refusalOf = (error: unknown): Refusal => {
  const id = invariantIdOf(error);
  if (id !== undefined) return { kind: 'invariant', id };
  if (isAppError(error)) return { kind: 'app', code: error.code };
  return {
    kind: 'stray',
    error:
      error instanceof Error ? `${error.name}: ${error.message}` : 'non-error',
  };
};

/** What a viewer of the Round can see at `nowMs`: the comparison for "the same state". */
export const viewAt = (runtime: Runtime, nowMs: number) => ({
  position: runtime.position(iso(nowMs)),
  checkpoint: runtime.checkpoint(),
});

export const iso = (ms: number) => new Date(ms).toISOString();

/** The participant who holds the floor of the open segment, read from the position. */
export const floorHolderOf = (
  rules: RoundRules,
  participants: readonly RoundParticipantSeat[],
  position: RoundPosition,
): RoundParticipantSeat | null => {
  const open = position.openSegment;
  if (open === null) return null;
  if (open.floorParticipantId !== null)
    return (
      participants.find((seat) => seat.id === open.floorParticipantId) ?? null
    );
  const lead = leadSeatOf(rules.segments[open.sequence]!.speak);
  return lead === null
    ? null
    : (participants.find((seat) => sameSeat(seat.seat, lead)) ?? null);
};

/** Completion facts with no ballots and a ballot deadline long past. */
export const panelCompletion = (
  participants: readonly RoundParticipantSeat[],
  nowMs: number,
) => {
  const judges = participants
    .filter((seat) => isJudgeSeat(seat.seat))
    .map((seat) => seat.id);
  const [first, ...rest] = judges;
  return {
    now: iso(nowMs),
    judging: {
      source: daisyBallotSource(daisyWinnerBallot),
      ballot: daisyWinnerBallot,
      panel: { decision: 'majority', quorum: 1 },
    } as const,
    ballots: [],
    completeness: 'complete' as const,
    panel: {
      humanWindow:
        first === undefined
          ? null
          : { deadlineAt: iso(0), seatIds: [first, ...rest] as const },
      aiSeats: [],
    },
  };
};
