import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { admitAllowance, canUseAiAllowance } from '@daisy/auth/authorization';
import { createRoundAnalysisRequests } from '../src/round-analysis-requests';
import type { AiAllowanceOptions } from '../src/usage-ledger';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { SQL } from 'bun';
import { createRoundAnalysisJobs } from '../src/round-analysis-jobs';
import { readRoundAnalysisFacts } from '../src/round-analysis-facts';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';

/**
 * A Round that completed a minute ago, its two human debaters' lines frozen
 * at revision 1; `affActorId` seats an existing debater as the affirmative.
 */
export async function completedRound(
  fixture: Fixture,
  roundId: string,
  frozen: boolean,
  beforeFreeze?: (aff: { id: string; actorId: string }) => Promise<void>,
  affActorId?: string,
  completedAgoMs = 60_000,
) {
  const [clock] = await fixture.sql`select clock_timestamp() as now`;
  const end = new Date(clock!.now.getTime() - completedAgoMs);
  const start = new Date(end.getTime() - 1000);
  await fixture.sql.unsafe(
    "update rounds set visibility='public',status='completed',outcome='affirmative',started_at=$2,completed_at=$3,final_segment_ended_at=$3,transcript_admission_cutoff=$4,attendance_resolution_cutoff_at=$3::timestamptz+interval '60 minutes' where id=$1",
    [roundId, start, end, new Date(end.getTime() + 120000)],
  );
  const aff = await fixture.seat(roundId, 'affirmative', 0, affActorId);
  const neg = await fixture.seat(roundId, 'negative');
  await fixture.sql`update users set email_verified=true where deleted_at is null and id in (select user_id from actors where id in (${aff.actorId},${neg.actorId}))`;
  const segmentId = createId();
  await fixture.insert('round_segments', {
    id: segmentId,
    round_id: roundId,
    sequence: 0,
    type: 'speech',
    rules_segment_key: 'AC',
    started_at: start,
    ended_at: end,
    duration_ms: 1000,
  });
  for (const [sequence, seat] of [
    [0, aff.id],
    [1, neg.id],
  ] as const)
    await fixture.sql`insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values(${createId()},${roundId},${segmentId},${seat},${sequence},'a frozen line')`;
  await fixture.sql`insert into round_transcripts(round_id,revision) values(${roundId},2)`;
  if (beforeFreeze) {
    await fixture.sql`update rounds set status='active',current_stage='live',completed_at=null,outcome=null where id=${roundId}`;
    await beforeFreeze(aff);
    await fixture.sql`update rounds set status='completed',current_stage=null,completed_at=${end},outcome='affirmative' where id=${roundId}`;
  }
  if (frozen)
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness)
      select ${roundId},1,revision,'complete' from round_transcripts where round_id=${roundId}`;
  return { aff, neg };
}

type Seat = { id: string; actorId: string };

/** A completed Round with its analysis store and a read of a seat's analysis facts. */
export const withCompletedRound = (
  work: (value: {
    fixture: Fixture;
    roundId: string;
    client: SQL;
    aff: Seat;
    neg: Seat;
    /** The seat keys the store takes. */
    seats: {
      aff: { roundId: string; roundParticipantId: string };
      neg: { roundId: string; roundParticipantId: string };
    };
    jobs: ReturnType<typeof createRoundAnalysisJobs>;
    request: (seat: {
      roundId: string;
      roundParticipantId: string;
    }) => ReturnType<ReturnType<typeof createRoundAnalysisRequests>>;
    caller: (seat: {
      roundParticipantId: string;
    }) => Promise<{ userId: string; actorId: string }>;
    facts: (seat: Seat) => ReturnType<typeof readRoundAnalysisFacts>;
  }) => Promise<void>,
  options: {
    readonly frozen?: boolean;
    readonly betaGrantsPremium?: boolean;
    readonly capacity?: number;
    readonly leaseMs?: number;
    readonly completedAgoMs?: number;
    readonly beforeFreeze?: (
      fixture: Fixture,
      client: SQL,
      aff: Seat,
    ) => Promise<void>;
  } = {},
) =>
  withBoundedRound(async (fixture, run, roundId, client) => {
    const { beforeFreeze } = options;
    const { aff, neg } = await completedRound(
      fixture,
      roundId,
      options.frozen ?? true,
      beforeFreeze ? (aff) => beforeFreeze(fixture, client, aff) : undefined,
      undefined,
      options.completedAgoMs,
    );
    const key = (seat: Seat) => ({ roundId, roundParticipantId: seat.id });
    const allowance: AiAllowanceOptions = {
      accountEligible: canUseAiAllowance,
      decide: (account, facts, request, now) =>
        admitAllowance(account, facts, request, {
          now,
          betaMonthlyCap: 5,
          betaGrantsPremium: options.betaGrantsPremium ?? true,
        }),
    };
    const request = createRoundAnalysisRequests({
      run,
      nextId: createId,
      allowance,
      capacity: options.capacity ?? 8,
    });
    const caller = async (seat: { roundParticipantId: string }) => {
      const [row] =
        await fixture.sql`select a.user_id as "userId",a.id as "actorId" from round_participants p join actors a on a.id=p.actor_id where p.id=${seat.roundParticipantId}`;
      if (!row?.userId) throw Error('Expected human fixture seat');
      return { userId: String(row.userId), actorId: String(row.actorId) };
    };
    await work({
      caller,
      request: async (seat) =>
        request({
          roundId: seat.roundId,
          caller: await caller(seat),
          authorize: (access) => canUseAiAllowance(access.account),
        }),
      fixture,
      roundId,
      client,
      aff,
      neg,
      seats: { aff: key(aff), neg: key(neg) },
      jobs: createRoundAnalysisJobs({
        run,
        nextId: createId,
        accountEligible: canUseAiAllowance,
        nextToken: () => randomBytes(32).toString('base64url'),
        leaseMs: options.leaseMs ?? 30000,
        model: 'anthropic/claude-sonnet-5.5',
      }),
      facts: (seat) => readRoundAnalysisFacts(drizzle({ client }), key(seat)),
    });
  });

/** Only durable requested work is discoverable, independent of Round age. */
export const listedSeats = async (
  jobs: ReturnType<typeof createRoundAnalysisJobs>,
) => (await jobs.scan(64)).map((s) => s.roundParticipantId);

export async function deliverAnalysis(
  jobs: ReturnType<typeof createRoundAnalysisJobs>,
  seat: { roundId: string; roundParticipantId: string },
  report: import('@daisy/protocol').RoundAnalysisReport,
) {
  const claim = await jobs.claim(seat);
  if (!claim) throw Error('Expected requested analysis claim');
  if (!(await jobs.dispatch(seat, claim.callId, claim.token)))
    throw Error('Expected dispatch');
  await jobs.observe(seat, claim.callId, claim.token, {
    kind: 'received',
    inputTokens: 900,
    outputTokens: 80,
  });
  await jobs.complete(seat, claim.callId, claim.token, report);
  return claim;
}
