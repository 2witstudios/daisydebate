import { createAppError } from '@daisy/errors';
import { ballotFeedbackSchema, type DebateSide } from '@daisy/protocol';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { roundFeedback } from './schema/round-feedback';
import { roundParticipants } from './schema/round-participants';
import { roundSegments } from './schema/round-segments';
import { rounds } from './schema/rounds';

/** Paid model calls one Round's coaching may buy over all its leases (ADR 0071). */
const MAX_FEEDBACK_CALLS = 2;
/** A Round is coached only this long after it completes; older ones never queue. */
const FEEDBACK_WINDOW_HOURS = 24;

type Reader = Pick<BunSQLDatabase, 'execute'>;

/**
 * A completed Round that needs coaching: recent, with a frozen transcript
 * that has lines, and no submitted AI ballot that already coached both sides.
 */
const needsCoaching = (roundId: SQL) => sql`exists (select 1 from rounds r
  where r.id = ${roundId} and r.status = 'completed'
    and r.completed_at > clock_timestamp() - make_interval(hours => ${FEEDBACK_WINDOW_HOURS})
    and exists (select 1 from round_transcript_freezes z where z.round_id = r.id)
    and exists (select 1 from utterances u where u.round_id = r.id)
    and not exists (select 1 from ballots b
      join round_participants p on p.id = b.judge_participant_id
      join actors a on a.id = p.actor_id
      where b.round_id = r.id and b.status = 'submitted' and a.kind = 'bot'
        and b.feedback ? 'affirmative' and b.feedback ? 'negative'))`;

/** No row, or a lapsed lease with calls left: the Round may be claimed. */
const claimable = (
  roundId: SQL,
) => sql`not exists (select 1 from round_feedback f
  where f.round_id = ${roundId}
    and (f.status <> 'leased' or f.lease_expires_at > clock_timestamp()
      or f.attempts >= ${MAX_FEEDBACK_CALLS}))`;

const sideFeedback = (value: unknown) => {
  const parsed = ballotFeedbackSchema.safeParse(value);
  if (!parsed.success) throw createAppError('INVARIANT');
  return parsed.data;
};

/** The Round's row while this token still holds its lease. */
const heldBy = (roundId: string, token: string) =>
  and(
    eq(roundFeedback.roundId, roundId),
    eq(roundFeedback.status, 'leased'),
    eq(roundFeedback.leaseTokenDigest, agentLeaseDigest(token)),
  );

/** The facts a reader's coaching state comes from; none of them is a secret. */
export async function readRoundFeedbackFacts(reader: Reader, roundId: string) {
  const [facts] = (await reader.execute(sql`select
    (select status from round_feedback where round_id = ${roundId}) as status,
    (select feedback from round_feedback where round_id = ${roundId}) as feedback,
    ${needsCoaching(sql`${roundId}`)} as eligible`)) as unknown as {
    status: (typeof roundFeedback.$inferSelect)['status'] | null;
    feedback: unknown;
    eligible: boolean;
  }[];
  return {
    status: facts?.status ?? null,
    feedback: facts?.feedback ? sideFeedback(facts.feedback) : null,
    eligible: facts?.eligible ?? false,
  };
}
export type RoundFeedbackFacts = Awaited<
  ReturnType<typeof readRoundFeedbackFacts>
>;

/**
 * The coaching job store. Discovery and claim run in short transactions; the
 * provider call happens outside any lock, and only the holder of the
 * current lease may record its result.
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
  return {
    /** Ends spent leases as failed, then lists Rounds that may be claimed. */
    scan: (limit: number) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        await tx.execute(sql`update round_feedback set status = 'failed',
          lease_token_digest = null, lease_expires_at = null, completed_at = clock_timestamp()
          where status = 'leased' and lease_expires_at <= clock_timestamp()
            and attempts >= ${MAX_FEEDBACK_CALLS}`);
        const rows =
          (await tx.execute(sql`select r.id as "roundId" from rounds r
          where r.status = 'completed' and ${needsCoaching(sql`r.id`)} and ${claimable(sql`r.id`)}
          order by r.completed_at, r.id limit ${limit}`)) as unknown as {
            roundId: string;
          }[];
        return rows.map((row) => row.roundId);
      });
    },
    /**
     * Takes the Round's next attempt and returns the evidence to coach, or
     * null when another process holds it or it no longer needs coaching.
     */
    claim: (roundId: string) =>
      input.run(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${roundId},59004))`,
        );
        const [open] = (await tx.execute(
          sql`select ${needsCoaching(sql`${roundId}`)} and ${claimable(sql`${roundId}`)} as open`,
        )) as unknown as { open: boolean }[];
        if (!open?.open) return null;
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
          })
          .returning({
            attempts: roundFeedback.attempts,
            freezeRevision: roundFeedback.freezeRevision,
          });
        if (claimed?.freezeRevision !== frozen.revision)
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
      const feedback = sideFeedback(result);
      if (!feedback.affirmative || !feedback.negative)
        throw createAppError('VALIDATION');
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
