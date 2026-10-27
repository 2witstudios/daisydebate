import { createAppError } from '@daisy/errors';
import {
  roundAnalysisLimits,
  roundAnalysisReportSchema,
  type RoundAnalysisReport,
  type RoundAnalysisSkill,
} from '@daisy/protocol';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import {
  readRoundAnalysisAccess,
  type RoundAnalysisAccess,
} from './round-analysis-access';
import {
  readRoundAnalysisFacts,
  type RoundAnalysisFacts,
} from './round-analysis-facts';
import { roundAnalyses } from './schema/round-analyses';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

/** What the round-analysis feature decided for one claim. */
export type RoundAnalysisClaimDecision = 'claim' | 'skip' | 'fail';

/** One debater seat of one Round: the unit a round analysis is made for. */
export type RoundAnalysisSeat = {
  readonly roundId: string;
  readonly roundParticipantId: string;
};

/** Erasure survives even when no freeze or analysis row existed at the time. */
const erasedParticipant = (roundId: string | SQL) => sql`exists (
  select 1 from round_participants p
  join actors a on a.id = p.actor_id
  join users u on u.id = a.user_id
  where p.round_id = ${roundId} and u.deleted_at is not null)`;

const seatRow = (seat: RoundAnalysisSeat) =>
  and(
    eq(roundAnalyses.roundId, seat.roundId),
    eq(roundAnalyses.roundParticipantId, seat.roundParticipantId),
  );

/** The seat's row while this token still holds its lease. */
const heldBy = (seat: RoundAnalysisSeat, token: string) =>
  and(
    seatRow(seat),
    eq(roundAnalyses.status, 'leased'),
    eq(roundAnalyses.leaseTokenDigest, agentLeaseDigest(token)),
  );

/** The database's own view that a lease has run out, whatever the app clock says. */
const lapsedLease = sql`${roundAnalyses.leaseExpiresAt} <= clock_timestamp()`;

/**
 * The same debater's earlier succeeded analyses, newest first: skill scores
 * only, for patterns. Only that debater's own seats in other Rounds are read.
 */
async function analysisHistory(
  tx: Parameters<Parameters<BoundedTransaction>[0]>[0],
  seat: RoundAnalysisSeat,
  actorId: string,
) {
  const rows = await tx
    .select({ report: roundAnalyses.report })
    .from(roundAnalyses)
    .innerJoin(
      roundParticipants,
      eq(roundParticipants.id, roundAnalyses.roundParticipantId),
    )
    .where(
      and(
        eq(roundParticipants.actorId, actorId),
        eq(roundAnalyses.status, 'succeeded'),
        sql`${roundAnalyses.roundId} <> ${seat.roundId}`,
      ),
    )
    .orderBy(desc(roundAnalyses.completedAt))
    .limit(roundAnalysisLimits.history);
  return rows.flatMap(({ report }) =>
    report
      ? [
          Object.fromEntries(
            Object.entries(report.skills).map(([skill, { score }]) => [
              skill,
              score,
            ]),
          ) as Record<RoundAnalysisSkill, number>,
        ]
      : [],
  );
}

/**
 * The round analysis job store: candidate discovery, the lease, the attempt
 * count and the report, all transactional, one row per debater seat.
 * Whether a seat is analysed is the round-analysis feature's decision, made
 * on fresh facts inside the claim's transaction before an attempt is spent.
 * The provider call happens outside any lock, and only the holder of the
 * current lease may record its result. No ballot is ever read.
 */
export function createRoundAnalysisJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextToken: () => string;
  /** Each paid attempt's lease, up to three minutes: longer than the provider call it covers. */
  readonly leaseMs: number;
  readonly model: string;
}) {
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    input.leaseMs > 180_000
  )
    throw createAppError('VALIDATION');
  if (!input.model.trim()) throw createAppError('VALIDATION');
  let cursor: {
    readonly completedAt: Date;
    readonly roundParticipantId: string;
  } | null = null;
  return {
    /**
     * Candidates only: the human debater seats of frozen Rounds with lines,
     * completed after `since`, with no analysis yet, and every lapsed lease,
     * so the decision can claim or end it. The prefilter only keeps seats
     * that cannot need an analysis from holding the batch; the decision
     * stays the authority.
     */
    scan: (
      limit: number,
      since: string,
      authorize: (access: RoundAnalysisAccess) => boolean,
    ) => {
      const from = new Date(since);
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 64 ||
        Number.isNaN(from.getTime())
      )
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const rows =
          (await tx.execute(sql`select r.id as "roundId", p.id as "roundParticipantId", r.completed_at as "completedAt"
          from rounds r
          join round_participants p on p.round_id = r.id and p.role in ('affirmative', 'negative')
          join actors a on a.id = p.actor_id and a.user_id is not null
          left join round_analyses f on f.round_id = r.id and f.round_participant_id = p.id
          where r.status = 'completed' and not ${erasedParticipant(sql`r.id`)}
          and (${cursor === null} or (r.completed_at, p.id) > (${cursor?.completedAt ?? from}, ${cursor?.roundParticipantId ?? ''})) and (
            (f.round_id is null and r.completed_at > ${from}
              and exists (select 1 from round_transcript_freezes z where z.round_id = r.id)
              and exists (select 1 from utterances u where u.round_id = r.id))
            or (f.status = 'leased' and f.lease_expires_at <= clock_timestamp()))
          order by r.completed_at, p.id limit ${limit}`)) as unknown as {
            roundId: string;
            roundParticipantId: string;
            completedAt: Date;
          }[];
        // Denied candidates cannot permanently monopolize the bounded scan.
        const last = rows.at(-1);
        cursor = rows.length === limit && last ? last : null;
        const permitted: RoundAnalysisSeat[] = [];
        for (const { roundId, roundParticipantId } of rows) {
          const seat = { roundId, roundParticipantId };
          if (authorize(await readRoundAnalysisAccess(tx, seat, 'discovery')))
            permitted.push(seat);
        }
        return permitted;
      });
    },
    /**
     * Reads the seat's facts under its Round's lock and applies `decide`: a
     * claim takes the next attempt and returns the frozen evidence, the
     * seat and its debater's history; a failure ends a held-out lease. Null
     * unless claimed.
     */
    claim: (
      seat: RoundAnalysisSeat,
      decide: (
        facts: RoundAnalysisFacts,
        access: RoundAnalysisAccess,
      ) => RoundAnalysisClaimDecision,
    ) =>
      input.run(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${seat.roundId},59004))`,
        );
        const [privacy] = (await tx.execute(
          sql`select ${erasedParticipant(seat.roundId)} as erased`,
        )) as unknown as { erased: boolean }[];
        if (!privacy) throw createAppError('INVARIANT');
        if (privacy.erased) return null;
        const access = await readRoundAnalysisAccess(tx, seat, 'claim');
        const decision = decide(await readRoundAnalysisFacts(tx, seat), access);
        if (decision === 'fail') {
          await tx
            .update(roundAnalyses)
            .set({
              status: 'failed',
              leaseTokenDigest: null,
              leaseExpiresAt: null,
              completedAt: sql`clock_timestamp()`,
            })
            .where(
              and(
                seatRow(seat),
                eq(roundAnalyses.status, 'leased'),
                lapsedLease,
              ),
            );
          return null;
        }
        if (decision !== 'claim') return null;
        const frozen = await readLockedFrozenRoundTranscript(tx, seat.roundId);
        if (!frozen) throw createAppError('INVARIANT');
        const token = input.nextToken();
        const leaseTokenDigest = agentLeaseDigest(token);
        const leaseExpiresAt = sql`clock_timestamp() + make_interval(secs => ${input.leaseMs / 1000})`;
        const [claimed] = await tx
          .insert(roundAnalyses)
          .values({
            ...seat,
            freezeRevision: frozen.revision,
            status: 'leased',
            attempts: 1,
            leaseTokenDigest,
            leaseExpiresAt,
            model: input.model,
          })
          .onConflictDoUpdate({
            target: roundAnalyses.roundParticipantId,
            set: {
              attempts: sql`${roundAnalyses.attempts} + 1`,
              leaseTokenDigest,
              leaseExpiresAt,
              model: input.model,
            },
            // Only a lease the database also sees lapsed is retaken; a
            // finished analysis never is, whatever was decided.
            setWhere: sql`${roundAnalyses.status} = 'leased' and ${lapsedLease}`,
          })
          .returning({
            attempts: roundAnalyses.attempts,
            freezeRevision: roundAnalyses.freezeRevision,
          });
        if (!claimed) return null;
        if (claimed.freezeRevision !== frozen.revision)
          throw createAppError('INVARIANT', 'Frozen analysis input changed');
        const [round] = await tx
          .select({ resolution: rounds.resolution })
          .from(rounds)
          .where(eq(rounds.id, seat.roundId));
        if (!round) throw createAppError('INVARIANT');
        const participants = await tx
          .select({
            id: roundParticipants.id,
            role: roundParticipants.role,
            slot: roundParticipants.slot,
          })
          .from(roundParticipants)
          .where(eq(roundParticipants.roundId, seat.roundId));
        const segments = await tx
          .select({ id: roundSegments.id, sequence: roundSegments.sequence })
          .from(roundSegments)
          .where(eq(roundSegments.roundId, seat.roundId))
          .orderBy(asc(roundSegments.sequence));
        return {
          token,
          attempt: claimed.attempts,
          model: input.model,
          seat: {
            ...seat,
            side: access.seat.side,
            slot: access.seat.slot,
          },
          round: {
            id: seat.roundId,
            resolution: round.resolution,
            participants,
            segments,
          },
          frozen,
          history: await analysisHistory(tx, seat, access.seat.actorId),
        };
      }),
    /** Adds one answered call's usage, whatever the answer held. */
    recordUsage: (
      seat: RoundAnalysisSeat,
      token: string,
      usage: { readonly inputTokens: number; readonly outputTokens: number },
    ) => {
      const counts = [usage.inputTokens, usage.outputTokens];
      if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0))
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        await tx
          .update(roundAnalyses)
          .set({
            inputTokens: sql`${roundAnalyses.inputTokens} + ${usage.inputTokens}`,
            outputTokens: sql`${roundAnalyses.outputTokens} + ${usage.outputTokens}`,
          })
          .where(heldBy(seat, token));
      });
    },
    /** Records the seat's report; refused once the lease is gone. */
    complete: (
      seat: RoundAnalysisSeat,
      token: string,
      result: RoundAnalysisReport,
    ) => {
      const parsed = roundAnalysisReportSchema.safeParse(result);
      if (!parsed.success) throw createAppError('VALIDATION');
      const report = parsed.data;
      return input.run(async (tx) => {
        const done = await tx
          .update(roundAnalyses)
          .set({
            status: 'succeeded',
            report,
            leaseTokenDigest: null,
            leaseExpiresAt: null,
            completedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              heldBy(seat, token),
              sql`${roundAnalyses.leaseExpiresAt} > clock_timestamp()`,
            ),
          )
          .returning({ roundId: roundAnalyses.roundId });
        if (!done.length)
          throw createAppError('CONFLICT', 'Round analysis lease changed');
      });
    },
  };
}
