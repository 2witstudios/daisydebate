import { z } from 'zod';
import { instantMs } from '@daisy/clock/instant';
import type { ClockStop } from './clock-stops';
import { idSchema } from './primitives';
import { sideKeySchema, type SideKey } from './seats';

/**
 * The one competition vocabulary (ADR 0058): ratedness comes from
 * `competition_type` alone, and casual is the one unranked type (DEC-233).
 * Every Round is full length (DEC-237): there is no length dimension.
 */
export const competitionTypes = ['ranked', 'casual'] as const;
export type CompetitionType = (typeof competitionTypes)[number];

/**
 * The round lifecycle. `opening` runs from Start round to the countdown:
 * rules are frozen, any strike and pre-round prep run, and the speech clock
 * has not started (ADR 0104). `abandoned` keeps `started_at` nullable.
 */
export const roundStatus = {
  opening: 'opening',
  active: 'active',
  completed: 'completed',
  abandoned: 'abandoned',
} as const;
/** A Round still running: in its opening or its debate, with no ending yet. */
export const runningRoundStatuses = [
  roundStatus.opening,
  roundStatus.active,
] as const;
export type RunningRoundStatus = (typeof runningRoundStatuses)[number];
/** A Round that has ended, with a result or without one. Nothing leaves these. */
export const overRoundStatuses = [
  roundStatus.completed,
  roundStatus.abandoned,
] as const;
export const roundStatuses = [
  ...runningRoundStatuses,
  ...overRoundStatuses,
] as const;
export const roundStatusSchema = z.enum(roundStatuses);
export type RoundStatus = (typeof roundStatuses)[number];
export type OverRoundStatus = (typeof overRoundStatuses)[number];
/** Whether a Round in `status` is still running. */
export const isRoundRunning = (
  status: RoundStatus,
): status is RunningRoundStatus =>
  (runningRoundStatuses as readonly RoundStatus[]).includes(status);
/**
 * When a Round's participants are told its decision (ADR 0144), frozen with
 * the Round: as it is finalized, or held until its organizer releases it.
 */
export const roundDecisionReleases = ['on_finalize', 'held'] as const;
export type RoundDecisionRelease = (typeof roundDecisionReleases)[number];

/**
 * Whether a change from `before` to `after` is the moment a Round begins: the
 * debate's clock starts (ADR 0144). An opening (strike, topic draw, prep) is
 * running but has not begun; `before` is null for a Round that did not exist.
 */
export const roundBegan = (
  before: RoundStatus | null,
  after: RoundStatus,
): boolean => after === 'active' && before !== 'active';
/** Whether a Round in `status` has ended. Every status is running or over. */
export const isRoundOver = (status: RoundStatus): status is OverRoundStatus =>
  (overRoundStatuses as readonly RoundStatus[]).includes(status);

/** Whether a Round in `status` ended with its debate played out or forfeited, not abandoned. */
export const isRoundCompleted = (status: RoundStatus) => status === 'completed';

/** Where a running round is: what the clock is doing, or that the debate is over and only its result is left. */
const roundStages = ['countdown', 'prep', 'live', 'awaiting_ballot'] as const;
export const roundStageSchema = z.enum(roundStages);
export type RoundStage = (typeof roundStages)[number];

/** What the server saw that made it pause a Round. Never a player's request. */
export const platformIncidentCauses = [
  'vendor_unreachable',
  'room_retired',
] as const;
const platformIncidentCauseSchema = z.enum(platformIncidentCauses);

/**
 * Why the platform, not the debate, ended a Round: it never recovered within the bound,
 * or the debate finished having lost more speech than can be judged.
 */
export const roundPlatformEndings = [
  'recovery_bound',
  'capture_shortfall',
] as const;
export type RoundPlatformEnding = (typeof roundPlatformEndings)[number];
export type PlatformIncidentCause = (typeof platformIncidentCauses)[number];

const incidentFields = {
  since: z.iso.datetime(),
  cause: platformIncidentCauseSchema,
  /** The end of the holder's last confirmed audio; null when no speech was open. */
  resume_point: z.iso.datetime().nullable(),
};

/**
 * A platform incident's hold on the clock, as one state so that impossible
 * combinations cannot be written. No player can cause it, hold it or end it.
 */
const incidentSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('none') }),
  z.strictObject({ phase: z.literal('paused'), ...incidentFields }),
  z.strictObject({
    phase: z.literal('resuming'),
    ...incidentFields,
    /** The instant the countdown ends and the clock runs. */
    until: z.iso.datetime(),
  }),
]);
export type RoundIncident = z.infer<typeof incidentSchema>;

/**
 * A speech may start only once capture has its speakers, or a short bound has passed
 * (ADR 0110). Absent, or for another segment, it holds nothing.
 */
const startGateSchema = z
  .discriminatedUnion('phase', [
    z.strictObject({
      phase: z.literal('awaiting'),
      sequence: z.int().min(0),
      /** The speakers capture has not reported on this room. */
      seats: z.array(idSchema).min(1).readonly(),
      /** The clock starts here regardless: capture failing never stalls a debate. */
      until: z.iso.datetime(),
    }),
    z.strictObject({
      phase: z.literal('ready'),
      sequence: z.int().min(0),
      /** When capture had them all. The clock starts here if this is past its due. */
      at: z.iso.datetime(),
    }),
  ])
  .nullable();
export type RoundStartGate = z.infer<typeof startGateSchema>;

/**
 * In-round prep, as one state (INTX-1). The side that speaks next may call it
 * while the previous segment still runs (`called`); it runs from the instant
 * that segment ends, or from the press in the gap (`running`); it ends at its
 * press or its budget, and the microphone opens one lead later (`lead`).
 * Effective consumption while it runs is
 * `prep_consumed_ms[side] + running time since started_at`.
 */
const roundPrepSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('idle') }),
  z.strictObject({ phase: z.literal('called'), side: sideKeySchema }),
  z.strictObject({
    phase: z.literal('running'),
    side: sideKeySchema,
    started_at: z.iso.datetime(),
  }),
  z.strictObject({ phase: z.literal('lead'), ended_at: z.iso.datetime() }),
]);

/** One opposing seat standing to offer a point of information. */
const pointOfInformationOfferSchema = z.strictObject({
  participant_id: idSchema,
  offered_at: z.iso.datetime(),
});

/**
 * A speech's point of information (INTX-13..15): nobody standing, opposing
 * seats offering, or one accepted offer being given. It lives only inside one
 * open speech; closing the segment returns it to `none`.
 */
const pointOfInformationSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('none') }),
  z.strictObject({
    phase: z.literal('offered'),
    offers: z
      .array(pointOfInformationOfferSchema)
      .min(1)
      .readonly()
      .refine(
        (offers) =>
          new Set(offers.map((offer) => offer.participant_id)).size ===
          offers.length,
        'A seat offers once at a time',
      ),
  }),
  z.strictObject({
    phase: z.literal('speaking'),
    holder_participant_id: idSchema,
    accepted_at: z.iso.datetime(),
  }),
]);
export type PointOfInformation = z.infer<typeof pointOfInformationSchema>;

/**
 * When an accepted point gives the speech back by itself: its acceptance plus
 * the rule's longest point. Null when no point is being given. The engine's
 * clock, the media reconcile and the browser all read this one instant.
 */
export const pointEndsAtMs = (
  point: PointOfInformation,
  maxDurationMs: number,
): number | null =>
  point.phase === 'speaking'
    ? instantMs(point.accepted_at) + maxDurationMs
    : null;

/**
 * The runtime checkpoint (ADR 0058 §4), version 2 — only what has no
 * durable row. The open `round_segments` row is the live interval; the
 * checkpoint holds the facts a restart could not otherwise reconstruct.
 * Keys are the stored jsonb shape, matching the column's database default
 * verbatim. `current_stage = 'prep'` iff prep is running; what relates the
 * checkpoint to the segment rows is the clock's to hold
 * (`normalizeRoundClock`).
 */
export const runtimeCheckpointSchema = z.strictObject({
  version: z.literal(2),
  /** Prep each side has spent, keyed by side key (TAB-6.2). */
  prep_consumed_ms: z.record(sideKeySchema, z.int().min(0)),
  prep: roundPrepSchema,
  point_of_information: pointOfInformationSchema,
  incident: incidentSchema,
  /** Whether capture is ready for the coming speech, which it may briefly hold. */
  start_gate: startGateSchema,
  /** Finished incidents' spans, so a countdown, a strike window or prep owes them back. */
  clock_stops: z
    .array(z.strictObject({ from: z.iso.datetime(), to: z.iso.datetime() }))
    .readonly(),
  /**
   * The competitor seats that left a Round no forfeit ends (TAB-6.8): each
   * is absent from then on, and the Round goes on without it. Omitted
   * while no seat has left, so every other checkpoint keeps its shape.
   */
  absent_participant_ids: z.array(idSchema).min(1).readonly().optional(),
});
export type RuntimeCheckpoint = z.infer<typeof runtimeCheckpointSchema>;

/** The checkpoint a fresh round over these sides hydrates with: no prep spent by any. */
export const emptyRuntimeCheckpointFor = (rules: {
  readonly sides: readonly { readonly key: SideKey }[];
}): RuntimeCheckpoint => ({
  version: 2,
  prep_consumed_ms: Object.fromEntries(
    rules.sides.map((side) => [side.key, 0]),
  ),
  prep: { phase: 'idle' },
  point_of_information: { phase: 'none' },
  incident: { phase: 'none' },
  start_gate: null,
  clock_stops: [],
});

/** Whether this seat has left the Round and is absent from then on (TAB-6.8). */
export const isAbsentSeat = (
  checkpoint: Pick<RuntimeCheckpoint, 'absent_participant_ids'>,
  participantId: string,
): boolean =>
  checkpoint.absent_participant_ids?.includes(participantId) ?? false;

/** Every stop the clock has had, with the one running now if there is one. */
export const clockStopsOf = (
  checkpoint: RuntimeCheckpoint,
): readonly ClockStop[] => {
  const { incident, clock_stops: finished } = checkpoint;
  if (incident.phase === 'none') return finished;
  return [
    ...finished,
    {
      from: incident.since,
      to: incident.phase === 'resuming' ? incident.until : null,
    },
  ];
};

/**
 * True when the held slots are exactly 0..wanted-1: a seat kind's seats are
 * complete. Both write paths enforce it — the room freeze and the round
 * start — so the predicate lives on the contract they both read.
 */
export const seatSlotsComplete = (
  wanted: number,
  held: readonly number[],
): boolean =>
  held.length === wanted && held.every((slot, index) => slot === index);

/** The prep a side has spent; a side the checkpoint has not yet named has spent none. */
export const prepConsumedOf = (
  checkpoint: Pick<RuntimeCheckpoint, 'prep_consumed_ms'>,
  side: SideKey,
): number => checkpoint.prep_consumed_ms[side] ?? 0;
