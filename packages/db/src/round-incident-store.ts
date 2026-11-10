import { createAppError } from '@daisy/errors';
import { idSchema, type RoundProjection } from '@daisy/protocol';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import {
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { sampleRoundExecutionTime } from './round-execution-time';
import { writeSpeakingProjection } from './round-speaking-writer';
import { mediaRoomRotations } from './schema/media-sessions';
import { roundIncidentWatches } from './schema/round-incident-watches';

type Reader = Pick<BunSQLDatabase, 'select'>;

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
  readonly kind: 'unchanged' | 'opened' | 'ended';
};

/**
 * The end of the current speakers' last confirmed audio: what capture heard of a person,
 * and a bot's authored lines (ADR 0122): the end of a phrase it played whole, or the
 * start of one cut short, which it says again whole on resume. Never before the open
 * speaking interval, whose close this becomes. Null when nobody holds an interval.
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
      (select max(case when u.complete and not u.interrupted
          then u.created_at + u.bot_duration_ms * interval '1 millisecond'
          else u.created_at end)
        from utterances u
        join holders h using (segment_id, round_participant_id)
        where u.round_id = ${roundId} and u.bot_phrase_id is not null)
    ) as confirmed_until
  `)) as unknown as { confirmed_until: Date | string | null }[];
  const value = rows[0]?.confirmed_until ?? null;
  return value === null ? null : new Date(value).toISOString();
}

/** What this revision did to the incident, as the observer reports it. */
const outcomeOf = (projection: RoundProjection): IncidentOutcome => {
  const changes = projection.incidentChanges ?? [];
  if (changes.some((change) => change.kind === 'ended'))
    return { kind: 'ended' };
  return changes.some((change) => change.kind === 'opened')
    ? { kind: 'opened' }
    : { kind: 'unchanged' };
};

/** What this feature knows between passes: its own row, and media's published rotations. */
async function readWatch(tx: Reader, roundId: string) {
  const [own] = await tx
    .select()
    .from(roundIncidentWatches)
    .where(eq(roundIncidentWatches.roundId, roundId));
  const [rotation] = await tx
    .select({ rotatedAt: mediaRoomRotations.rotatedAt })
    .from(mediaRoomRotations)
    .where(
      and(
        eq(mediaRoomRotations.roundId, roundId),
        ne(mediaRoomRotations.cause, 'seat-revoked'),
      ),
    )
    .orderBy(desc(mediaRoomRotations.rotatedAt))
    .limit(1);
  const takenUp = own?.retirementTakenUpAt ?? null;
  const retiredAt = rotation?.rotatedAt ?? null;
  return {
    unreachableSince: own?.unreachableSince ?? null,
    takenUp,
    retiredAt,
    roomRetired:
      retiredAt !== null && (takenUp === null || retiredAt > takenUp),
  };
}

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
    /** An ordinary pass's unlocked read, so a healthy Round costs no Round lock. */
    readRoundIncidentWatch: (roundId: string) =>
      deps.run(async (tx) => {
        const { roomRetired, unreachableSince } = await readWatch(tx, roundId);
        return {
          roomRetired,
          unreachableSince: unreachableSince?.toISOString() ?? null,
        };
      }),
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
        const known = await readWatch(tx, input.roundId);
        const unreachableSince = input.watch.unreachable
          ? (known.unreachableSince ?? new Date(now))
          : input.watch.roomRead
            ? null
            : known.unreachableSince;
        const remember = (retirementTakenUpAt: Date | null) =>
          tx
            .insert(roundIncidentWatches)
            .values({
              roundId: input.roundId,
              unreachableSince,
              retirementTakenUpAt,
            })
            .onConflictDoUpdate({
              target: roundIncidentWatches.roundId,
              set: { unreachableSince, retirementTakenUpAt },
            });
        if (read.status !== 'active' && read.status !== 'opening') {
          await remember(known.retiredAt);
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
        const step = await input.decide({
          round,
          now,
          roomRetired: known.roomRetired,
          unreachableSince: unreachableSince?.toISOString() ?? null,
          confirmedUntil: () => confirmedUntil(tx, input.roundId),
        });
        // The decision has taken up the retirement it read, and no later one: a rotation
        // committing after that read stays newer. A failure from here rolls this back too.
        await remember(known.retiredAt);
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
        return outcomeOf(projection);
      });
    },
  };
}
