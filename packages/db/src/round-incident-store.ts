import { createAppError } from '@daisy/errors';
import { idSchema, type RoundProjection } from '@daisy/protocol';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { sampleRoundExecutionTime } from './round-execution-time';
import { writeSpeakingProjection } from './round-speaking-writer';
import { mediaSessions } from './schema/media-sessions';
import { roundIncidents } from './schema/round-incidents';

/** What a pass read from the vendor, as far as this store keeps it. */
export type IncidentWatch = {
  /** The vendor could not be read in this pass. */
  readonly unreachable: boolean;
  /** The capture agent is listed; null when this pass read no room. */
  readonly captureListed: boolean | null;
};

/** The durable facts the injected decision reads, under the Round lock. */
export type IncidentContext = {
  readonly round: RoundHydration;
  readonly now: string;
  readonly sawCapture: boolean;
  readonly unreachableSince: string | null;
};

/** The injected decision's answer, and the engine's projection of it. */
export type IncidentStep = {
  readonly projection: RoundProjection;
} | null;

export type IncidentOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'opened' | 'held_again' | 'resuming' | 'ended' };

/**
 * The end of the current speakers' last confirmed audio: heard by capture, or
 * credited to a bot seat. Never before the open speaking interval, whose close
 * this becomes. Null when nobody holds an interval.
 */
async function confirmedUntil(
  tx: Pick<BoundedTransactionContext, 'execute'>,
  roundId: string,
): Promise<string | null> {
  const rows = (await tx.execute(sql`
    with holders as (
      select segment_id, round_participant_id, started_at
      from round_speaking_intervals
      where round_id = ${roundId} and ended_at is null
    )
    select greatest(
      (select max(started_at) from holders),
      (select max(o.observed_until) from transcript_observations o
        join holders h using (segment_id, round_participant_id)
        where o.round_id = ${roundId}),
      (select max(w.credited_until) from round_bot_publication_windows w
        join holders h using (segment_id, round_participant_id)
        where w.round_id = ${roundId})
    ) as confirmed_until
  `)) as unknown as { confirmed_until: Date | string | null }[];
  const value = rows[0]?.confirmed_until ?? null;
  return value === null ? null : new Date(value).toISOString();
}

const nextPhaseOf = (projection: RoundProjection) =>
  projection.round?.checkpoint.incident ?? null;

/**
 * One concept, one home: a platform incident's transaction. The server's own
 * observation goes in, the engine's injected decision runs under the Round lock,
 * and the incident's durable row moves with the Round in one commit. A
 * rejected decision leaves everything as it was.
 */
export function createRoundIncidentStore(deps: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    async observeRoundIncident(input: {
      readonly roundId: string;
      readonly watch: IncidentWatch;
      readonly decide: (
        context: IncidentContext & {
          readonly confirmedUntil: () => Promise<string | null>;
        },
      ) => Promise<IncidentStep>;
    }): Promise<IncidentOutcome> {
      if (!idSchema.safeParse(input.roundId).success)
        throw createAppError('VALIDATION');
      return deps.run(async (tx) => {
        const current = await lockedRoundVersion(tx, input.roundId);
        const round = await hydrateRoundRows(tx, input.roundId);
        if (!round) throw createAppError('NOT_FOUND');
        const now = await sampleRoundExecutionTime(tx);
        const [session] = await tx
          .select({
            unreachableSince: mediaSessions.vendorUnreachableSince,
            sawCapture: mediaSessions.roomSawCapture,
          })
          .from(mediaSessions)
          .where(eq(mediaSessions.roundId, input.roundId));
        if (!session) return { kind: 'unchanged' };
        const unreachableSince = input.watch.unreachable
          ? (session.unreachableSince ?? new Date(now))
          : input.watch.captureListed === null
            ? session.unreachableSince
            : null;
        const sawCapture = input.watch.captureListed ?? session.sawCapture;
        await tx
          .update(mediaSessions)
          .set({
            vendorUnreachableSince: unreachableSince,
            roomSawCapture: sawCapture,
          })
          .where(eq(mediaSessions.roundId, input.roundId));
        if (round.status !== 'active' && round.status !== 'opening')
          return { kind: 'unchanged' };
        const before = round.checkpoint.incident.phase;
        const step = await input.decide({
          round,
          now,
          // The decision reads the session's state before this observation.
          sawCapture: session.sawCapture,
          unreachableSince: unreachableSince?.toISOString() ?? null,
          confirmedUntil: () => confirmedUntil(tx, input.roundId),
        });
        if (step === null) return { kind: 'unchanged' };
        const { projection } = step;
        const changed = await writeProjectionWithPhaseSignal(
          tx,
          input.roundId,
          current,
          projection,
          now,
        );
        await writeSpeakingProjection(tx, {
          roundId: input.roundId,
          projection,
          resultingVersion: current.version + (changed ? 1 : 0),
          commandId: null,
        });
        return writeIncidentRow(tx, {
          id: deps.nextId,
          roundId: input.roundId,
          before,
          projection,
          now,
        });
      });
    },
  };
}

const openIncident = (roundId: string) =>
  and(
    eq(roundIncidents.roundId, roundId),
    isNull(roundIncidents.resumedAt),
    isNull(roundIncidents.endedAt),
  );

/** The row follows the checkpoint; the two commit together. */
async function writeIncidentRow(
  tx: BoundedTransactionContext,
  input: {
    readonly id: () => string;
    readonly roundId: string;
    readonly before: string;
    readonly projection: RoundProjection;
    readonly now: string;
  },
): Promise<IncidentOutcome> {
  const { roundId, before, projection } = input;
  const incident = nextPhaseOf(projection);
  if (projection.round?.status === 'abandoned') {
    await tx
      .update(roundIncidents)
      .set({ endedAt: new Date(input.now), resumedAt: null, returnedMs: 0 })
      .where(
        and(
          eq(roundIncidents.roundId, roundId),
          isNull(roundIncidents.endedAt),
        ),
      );
    return { kind: 'ended' };
  }
  if (incident?.phase === 'paused' && before === 'none') {
    await tx.insert(roundIncidents).values({
      id: input.id(),
      roundId,
      cause: incident.cause,
      detectedAt: new Date(incident.since),
    });
    return { kind: 'opened' };
  }
  if (incident?.phase === 'paused' && before === 'resuming') {
    // Its resume instant moved out again, so this row is the open one once more.
    await tx
      .update(roundIncidents)
      .set({ resumedAt: null, returnedMs: 0 })
      .where(
        and(
          eq(roundIncidents.roundId, roundId),
          isNull(roundIncidents.endedAt),
          eq(roundIncidents.detectedAt, new Date(incident.since)),
        ),
      );
    return { kind: 'held_again' };
  }
  if (incident?.phase === 'resuming' && before === 'paused') {
    const untilMs = Date.parse(incident.until);
    await tx
      .update(roundIncidents)
      .set({
        resumedAt: new Date(untilMs),
        returnedMs:
          incident.resume_point === null
            ? 0
            : untilMs - Date.parse(incident.resume_point),
      })
      .where(openIncident(roundId));
    return { kind: 'resuming' };
  }
  return { kind: 'unchanged' };
}
