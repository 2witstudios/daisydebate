import { z } from 'zod';
import type { ClockStop } from './clock-stops';
import { debateSideSchema, idSchema } from './primitives';

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
export const roundStatuses = [
  'opening',
  'active',
  'completed',
  'abandoned',
] as const;
export const roundStatusSchema = z.enum(roundStatuses);
export type RoundStatus = (typeof roundStatuses)[number];
/** A Round still running: in its opening or its debate, with no ending yet. */
export const runningRoundStatuses = [
  'opening',
  'active',
] as const satisfies readonly RoundStatus[];
export type RunningRoundStatus = (typeof runningRoundStatuses)[number];
/** A Round that has ended, with a result or without one. Nothing leaves these. */
const overRoundStatuses = [
  'completed',
  'abandoned',
] as const satisfies readonly RoundStatus[];
export type OverRoundStatus = (typeof overRoundStatuses)[number];
/** Whether a Round in `status` is still running. */
export const isRoundRunning = (
  status: RoundStatus,
): status is RunningRoundStatus =>
  (runningRoundStatuses as readonly RoundStatus[]).includes(status);
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
export const platformIncidentCauseSchema = z.enum(platformIncidentCauses);

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
 * The runtime checkpoint (ADR 0058 §4), version 1 — only what has no
 * durable row. The open `round_segments` row is the live interval; the
 * checkpoint holds the three facts a restart could not otherwise
 * reconstruct. Keys are the stored jsonb shape, matching the column's
 * database default verbatim. The equivalence: `current_stage = 'prep'` iff
 * `active_prep` is not null; effective prep consumption while prep is live
 * is `prep_consumed_ms[side] + (now - active_prep.started_at)`. The lead after
 * prep and prep itself never hold at once; what relates the checkpoint to the
 * segment rows is the clock's to hold (`normalizeRoundClock`).
 */
export const runtimeCheckpointSchema = z
  .strictObject({
    version: z.literal(1),
    prep_consumed_ms: z.strictObject({
      affirmative: z.int().min(0),
      negative: z.int().min(0),
    }),
    active_prep: z
      .strictObject({ side: debateSideSchema, started_at: z.iso.datetime() })
      .nullable(),
    /**
     * Who holds the floor. Null whenever the answer is derivable from the
     * open segment plus the rules — i.e. the segment's own scheduled side
     * holds it. Set only by an accepted interruption; deliberately not the
     * legal-next participant, which would duplicate the rules and go stale.
     */
    floor: z
      .strictObject({
        holder_participant_id: idSchema,
        granted_at: z.iso.datetime(),
      })
      .nullable(),
    incident: incidentSchema,
    /**
     * When in-round prep ended. The next clock starts the microphone lead after this, so no
     * microphone opens during prep. Null outside that lead; never set while prep runs.
     */
    prep_ended_at: z.iso.datetime().nullable(),
    /** Whether capture is ready for the coming speech, which it may briefly hold. */
    start_gate: startGateSchema,
    /** Finished incidents' spans, so a countdown, a strike window or prep owes them back. */
    clock_stops: z
      .array(z.strictObject({ from: z.iso.datetime(), to: z.iso.datetime() }))
      .readonly(),
  })
  .refine(
    (checkpoint) =>
      checkpoint.prep_ended_at === null || checkpoint.active_prep === null,
    {
      message: 'The lead after prep never runs while prep does',
      path: ['prep_ended_at'],
    },
  );
export type RuntimeCheckpoint = z.infer<typeof runtimeCheckpointSchema>;

/** The checkpoint a fresh round hydrates with, equal to the column default. */
export const emptyRuntimeCheckpoint: RuntimeCheckpoint = {
  version: 1,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
  incident: { phase: 'none' },
  prep_ended_at: null,
  start_gate: null,
  clock_stops: [],
};

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
 * True when the held slots are exactly 0..wanted-1: a role's seats are
 * complete. Both write paths enforce it — the room freeze and the round
 * start — so the predicate lives on the contract they both read.
 */
export const seatSlotsComplete = (
  wanted: number,
  held: readonly number[],
): boolean =>
  held.length === wanted && held.every((slot, index) => slot === index);
