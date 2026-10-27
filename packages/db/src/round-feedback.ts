import {
  readRoundCoachingAccess,
  type RoundCoachingAccess,
} from './round-coaching-access';
import { createAppError } from '@daisy/errors';
import {
  ballotFeedbackSchema,
  debateSides,
  type DebateSide,
} from '@daisy/protocol';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { roundFeedback } from './schema/round-feedback';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

type Reader = Pick<BunSQLDatabase, 'execute'>;

const instant = z
  .union([z.date(), z.string()])
  .transform((value) => new Date(value).toISOString());
const factsSchema = z.object({
  status: z.string(),
  completed_at: instant.nullable(),
  frozen: z.boolean(),
  lines: z.coerce.number().int().nonnegative(),
  ai_ballots: z.array(
    z.object({ submitted: z.boolean(), sides: z.array(z.string()) }),
  ),
  pass: z
    .object({
      status: z.enum(['leased', 'succeeded', 'failed']),
      attempts: z.number().int().positive(),
      leaseExpiresAt: instant.nullable(),
      feedback: ballotFeedbackSchema.nullable(),
    })
    .nullable(),
});

/**
 * Plain facts the coaching decision is made from (ADR 0071). The decision,
 * its window and its budget belong to the coaching feature, not here.
 */
export type RoundCoachingFacts = {
  readonly status: string;
  readonly completedAt: string | null;
  /** Whether the Round froze a transcript, and how many lines it has. */
  readonly frozen: boolean;
  readonly lines: number;
  /** Each AI judge ballot: whether it is submitted, and the sides it coached. */
  readonly aiBallots: readonly {
    readonly submitted: boolean;
    readonly sides: readonly DebateSide[];
  }[];
  /** The coaching pass's row, once any attempt was claimed. */
  readonly pass: {
    readonly status: 'leased' | 'succeeded' | 'failed';
    readonly attempts: number;
    readonly leaseExpiresAt: string | null;
    readonly feedback: Readonly<Partial<Record<DebateSide, string>>> | null;
  } | null;
};

/** What the coaching feature decided for one claim. */
export type CoachingClaimDecision = 'claim' | 'skip' | 'fail';

export async function readRoundCoachingFacts(
  reader: Reader,
  roundId: string,
): Promise<RoundCoachingFacts> {
  const [row] = (await reader.execute(sql`select r.status, r.completed_at,
    exists (select 1 from round_transcript_freezes z where z.round_id = r.id) as frozen,
    (select count(*) from utterances u where u.round_id = r.id) as lines,
    coalesce((select json_agg(json_build_object(
        'submitted', b.status = 'submitted',
        'sides', (select coalesce(json_agg(k), '[]'::json)
          from jsonb_object_keys(coalesce(b.feedback, '{}'::jsonb)) k)))
      from ballots b
      join round_participants p on p.id = b.judge_participant_id
      join actors a on a.id = p.actor_id
      where b.round_id = r.id and a.kind = 'bot'), '[]'::json) as ai_ballots,
    (select json_build_object('status', f.status, 'attempts', f.attempts,
        'leaseExpiresAt', f.lease_expires_at, 'feedback', f.feedback)
      from round_feedback f where f.round_id = r.id) as pass
    from rounds r where r.id = ${roundId}`)) as unknown as unknown[];
  if (!row) throw createAppError('NOT_FOUND');
  const facts = factsSchema.parse(row);
  return {
    status: facts.status,
    completedAt: facts.completed_at,
    frozen: facts.frozen,
    lines: facts.lines,
    aiBallots: facts.ai_ballots.map((ballot) => ({
      submitted: ballot.submitted,
      sides: debateSides.filter((side) => ballot.sides.includes(side)),
    })),
    pass: facts.pass,
  };
}

/** The Round's row while this token still holds its lease. */
const heldBy = (roundId: string, token: string) =>
  and(
    eq(roundFeedback.roundId, roundId),
    eq(roundFeedback.status, 'leased'),
    eq(roundFeedback.leaseTokenDigest, agentLeaseDigest(token)),
  );

/** The database's own view that a lease has run out, whatever the app clock says. */
const lapsedLease = sql`${roundFeedback.leaseExpiresAt} <= clock_timestamp()`;

/** Ends a held-out lease: the coaching feature decided the Round gets no more calls. */
const failLease = (roundId: string) => ({
  set: {
    status: 'failed' as const,
    leaseTokenDigest: null,
    leaseExpiresAt: null,
    completedAt: sql`clock_timestamp()`,
  },
  where: and(
    eq(roundFeedback.roundId, roundId),
    eq(roundFeedback.status, 'leased'),
    lapsedLease,
  ),
});

/**
 * The coaching job store: candidate discovery, the lease, the attempt count
 * and the result, all transactional. Whether a Round is coached is the
 * coaching feature's decision, made on fresh facts inside the claim's
 * transaction before an attempt is spent. The provider call happens outside
 * any lock, and only the holder of the current lease may record its result.
 */
export function createRoundFeedbackJobs(input: {
  readonly run: BoundedTransaction;
  readonly nextToken: () => string;
  /** Each paid attempt's lease, up to two minutes: longer than the provider call it covers. */
  readonly leaseMs: number;
  readonly model: string;
}) {
  if (
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1 ||
    input.leaseMs > 120_000
  )
    throw createAppError('VALIDATION');
  if (!input.model.trim()) throw createAppError('VALIDATION');
  let cursor: { readonly completedAt: Date; readonly roundId: string } | null =
    null;
  return {
    /**
     * Candidates only: frozen Rounds with lines, completed after `since`,
     * with no pass yet and not already coached on both sides by a submitted
     * AI ballot, and every lapsed lease, so the decision can claim or end it.
     * The prefilter only keeps Rounds that cannot need coaching from holding
     * the batch; the decision stays the authority.
     */
    scan: (
      limit: number,
      since: string,
      authorize: (access: RoundCoachingAccess) => boolean,
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
          (await tx.execute(sql`select r.id as "roundId", r.completed_at as "completedAt" from rounds r
          left join round_feedback f on f.round_id = r.id
          where r.status = 'completed'
          and (${cursor === null} or (r.completed_at, r.id) > (${cursor?.completedAt ?? from}, ${cursor?.roundId ?? ''})) and (
            (f.round_id is null and r.completed_at > ${from}
              and exists (select 1 from round_transcript_freezes z where z.round_id = r.id)
              and exists (select 1 from utterances u where u.round_id = r.id)
              and not exists (select 1 from ballots b
                join round_participants p on p.id = b.judge_participant_id
                join actors a on a.id = p.actor_id
                where b.round_id = r.id and b.status = 'submitted' and a.kind = 'bot'
                  and b.feedback ? 'affirmative' and b.feedback ? 'negative'))
            or (f.status = 'leased' and f.lease_expires_at <= clock_timestamp()))
          order by r.completed_at, r.id limit ${limit}`)) as unknown as {
            roundId: string;
            completedAt: Date;
          }[];
        // Denied candidates cannot permanently monopolize the bounded scan.
        const last = rows.at(-1);
        cursor = rows.length === limit && last ? last : null;
        const permitted: string[] = [];
        for (const row of rows) {
          if (
            authorize(
              await readRoundCoachingAccess(tx, row.roundId, 'discovery'),
            )
          )
            permitted.push(row.roundId);
        }
        return permitted;
      });
    },
    /**
     * Reads the Round's facts under its lock and applies `decide`: a claim
     * takes the next attempt and returns the frozen evidence to coach; a
     * failure ends a held-out lease. Null unless claimed.
     */
    claim: (
      roundId: string,
      decide: (
        facts: RoundCoachingFacts,
        access: RoundCoachingAccess,
      ) => CoachingClaimDecision,
    ) =>
      input.run(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${roundId},59004))`,
        );
        const access = await readRoundCoachingAccess(tx, roundId, 'claim');
        const decision = decide(
          await readRoundCoachingFacts(tx, roundId),
          access,
        );
        if (decision === 'fail') {
          const failed = failLease(roundId);
          await tx.update(roundFeedback).set(failed.set).where(failed.where);
          return null;
        }
        if (decision !== 'claim') return null;
        const frozen = await readLockedFrozenRoundTranscript(tx, roundId);
        if (!frozen) throw createAppError('INVARIANT');
        const token = input.nextToken();
        const leaseTokenDigest = agentLeaseDigest(token);
        const leaseExpiresAt = sql`clock_timestamp() + make_interval(secs => ${input.leaseMs / 1000})`;
        const [claimed] = await tx
          .insert(roundFeedback)
          .values({
            roundId,
            freezeRevision: frozen.revision,
            status: 'leased',
            attempts: 1,
            leaseTokenDigest,
            leaseExpiresAt,
            model: input.model,
          })
          .onConflictDoUpdate({
            target: roundFeedback.roundId,
            set: {
              attempts: sql`${roundFeedback.attempts} + 1`,
              leaseTokenDigest,
              leaseExpiresAt,
              model: input.model,
            },
            // Only a lease the database also sees lapsed is retaken; a
            // finished pass never is, whatever was decided.
            setWhere: sql`${roundFeedback.status} = 'leased' and ${lapsedLease}`,
          })
          .returning({
            attempts: roundFeedback.attempts,
            freezeRevision: roundFeedback.freezeRevision,
          });
        if (!claimed) return null;
        if (claimed.freezeRevision !== frozen.revision)
          throw createAppError('INVARIANT', 'Frozen coaching input changed');
        const [round] = await tx
          .select({ resolution: rounds.resolution })
          .from(rounds)
          .where(eq(rounds.id, roundId));
        if (!round) throw createAppError('INVARIANT');
        const participants = await tx
          .select({
            id: roundParticipants.id,
            role: roundParticipants.role,
            slot: roundParticipants.slot,
          })
          .from(roundParticipants)
          .where(eq(roundParticipants.roundId, roundId));
        const segments = await tx
          .select({ id: roundSegments.id, sequence: roundSegments.sequence })
          .from(roundSegments)
          .where(eq(roundSegments.roundId, roundId))
          .orderBy(asc(roundSegments.sequence));
        return {
          token,
          attempt: claimed.attempts,
          model: input.model,
          round: {
            id: roundId,
            resolution: round.resolution,
            participants,
            segments,
          },
          frozen,
        };
      }),
    /** Adds one answered call's usage, whatever the answer held. */
    recordUsage: (
      roundId: string,
      token: string,
      usage: { readonly inputTokens: number; readonly outputTokens: number },
    ) => {
      const counts = [usage.inputTokens, usage.outputTokens];
      if (!counts.every((n) => Number.isSafeInteger(n) && n >= 0))
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        await tx
          .update(roundFeedback)
          .set({
            inputTokens: sql`${roundFeedback.inputTokens} + ${usage.inputTokens}`,
            outputTokens: sql`${roundFeedback.outputTokens} + ${usage.outputTokens}`,
          })
          .where(heldBy(roundId, token));
      });
    },
    /** Records the coaching for both sides; refused once the lease is gone. */
    complete: (
      roundId: string,
      token: string,
      result: Readonly<Partial<Record<DebateSide, string>>>,
    ) => {
      const parsed = ballotFeedbackSchema.safeParse(result);
      if (!parsed.success || !parsed.data.affirmative || !parsed.data.negative)
        throw createAppError('VALIDATION');
      const feedback = parsed.data;
      return input.run(async (tx) => {
        const done = await tx
          .update(roundFeedback)
          .set({
            status: 'succeeded',
            feedback,
            leaseTokenDigest: null,
            leaseExpiresAt: null,
            completedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              heldBy(roundId, token),
              sql`${roundFeedback.leaseExpiresAt} > clock_timestamp()`,
            ),
          )
          .returning({ roundId: roundFeedback.roundId });
        if (!done.length)
          throw createAppError('CONFLICT', 'Coaching lease changed');
      });
    },
  };
}
