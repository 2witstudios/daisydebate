import { createAppError } from '@daisy/errors';
import {
  idSchema,
  type RoundIncident,
  type RoundProjection,
} from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
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

/** What a pass read from the vendor, as far as this store keeps it. */
export type IncidentWatch = {
  /** The vendor could not be read in this pass. */
  readonly unreachable: boolean;
  /** The vendor answered with a read of the room. */
  readonly roomRead: boolean;
};

/** The durable facts the injected decision reads, under the Round lock. */
export type IncidentContext = {
  readonly round: RoundHydration;
  readonly now: string;
  /** A pass retired the room, and no incident has taken that up. */
  readonly roomRetired: boolean;
  readonly unreachableSince: string | null;
};

/** The injected decision's answer, and the engine's projection of it. */
export type IncidentStep = {
  readonly projection: RoundProjection;
} | null;

export type IncidentOutcome = {
  readonly kind: 'unchanged' | 'opened' | 'held_again' | 'resuming' | 'ended';
};

/**
 * The end of the current speakers' last confirmed audio. Only capture confirms audio, for
 * a bot seat too: a bot's credit says a publish was authorized, not that anyone heard it.
 * Never before the open speaking interval, whose close this becomes. Null when nobody
 * holds an interval.
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
        where o.round_id = ${roundId})
    ) as confirmed_until
  `)) as unknown as { confirmed_until: Date | string | null }[];
  const value = rows[0]?.confirmed_until ?? null;
  return value === null ? null : new Date(value).toISOString();
}

/** What this revision did to the incident, as the observer reports it. */
const outcomeOf = (
  before: RoundIncident['phase'],
  projection: RoundProjection,
): IncidentOutcome => {
  const changes = projection.incidentChanges ?? [];
  if (changes.some((change) => change.kind === 'ended'))
    return { kind: 'ended' };
  if (changes.some((change) => change.kind === 'opened'))
    return { kind: 'opened' };
  const after = projection.round?.checkpoint.incident.phase;
  if (after === 'resuming' && before === 'paused') return { kind: 'resuming' };
  if (after === 'paused' && before === 'resuming')
    return { kind: 'held_again' };
  return { kind: 'unchanged' };
};

/**
 * One concept, one home: a platform incident's transaction. The server's own observation
 * goes in, the engine's injected decision runs under the Round lock, and the Round moves
 * in one commit. A rejected decision leaves everything as it was. A resume already due is
 * settled first, so the decision reads the Round as it stands, not as it was last ticked.
 */
export function createRoundIncidentStore(deps: {
  readonly run: BoundedTransaction;
}) {
  return {
    async observeRoundIncident(input: {
      readonly roundId: string;
      readonly watch: IncidentWatch;
      readonly settle: (round: RoundHydration, now: string) => RoundProjection;
      readonly decide: (
        context: IncidentContext & {
          readonly confirmedUntil: () => Promise<string | null>;
        },
      ) => Promise<IncidentStep>;
    }): Promise<IncidentOutcome> {
      if (!idSchema.safeParse(input.roundId).success)
        throw createAppError('VALIDATION');
      return deps.run(async (tx) => {
        const locked = await lockedRoundVersion(tx, input.roundId);
        const read = await hydrateRoundRows(tx, input.roundId);
        if (!read) throw createAppError('NOT_FOUND');
        const now = await sampleRoundExecutionTime(tx);
        const [session] = await tx
          .select({
            unreachableSince: mediaSessions.vendorUnreachableSince,
            roomRetiredAt: mediaSessions.roomRetiredAt,
          })
          .from(mediaSessions)
          .where(eq(mediaSessions.roundId, input.roundId));
        if (!session) return { kind: 'unchanged' };
        const unreachableSince = input.watch.unreachable
          ? (session.unreachableSince ?? new Date(now))
          : input.watch.roomRead
            ? null
            : session.unreachableSince;
        if (read.status !== 'active' && read.status !== 'opening') {
          await tx
            .update(mediaSessions)
            .set({
              vendorUnreachableSince: unreachableSince,
              roomRetiredAt: null,
            })
            .where(eq(mediaSessions.roundId, input.roundId));
          return { kind: 'unchanged' };
        }
        const due =
          read.checkpoint.incident.phase === 'resuming' &&
          Date.parse(now) >= Date.parse(read.checkpoint.incident.until);
        const settling = due ? input.settle(read, now) : null;
        const settled =
          settling &&
          (await writeProjectionWithPhaseSignal(
            tx,
            input.roundId,
            locked,
            settling,
            now,
          ));
        if (settling)
          await writeSpeakingProjection(tx, {
            roundId: input.roundId,
            projection: settling,
            resultingVersion: locked.version + (settled ? 1 : 0),
            commandId: null,
          });
        const current = settling
          ? await lockedRoundVersion(tx, input.roundId)
          : locked;
        const round = settling
          ? await hydrateRoundRows(tx, input.roundId)
          : read;
        if (!round) throw createAppError('NOT_FOUND');
        const before = round.checkpoint.incident.phase;
        const step = await input.decide({
          round,
          now,
          roomRetired: session.roomRetiredAt !== null,
          unreachableSince: unreachableSince?.toISOString() ?? null,
          confirmedUntil: () => confirmedUntil(tx, input.roundId),
        });
        // The decision has taken the retirement up; a failure from here rolls this back too.
        await tx
          .update(mediaSessions)
          .set({
            vendorUnreachableSince: unreachableSince,
            roomRetiredAt: null,
          })
          .where(eq(mediaSessions.roundId, input.roundId));
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
        return outcomeOf(before, projection);
      });
    },
  };
}
