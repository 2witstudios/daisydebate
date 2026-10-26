import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { SQL } from 'bun';
import {
  createRoundFeedbackJobs,
  readRoundCoachingFacts,
} from '../src/round-feedback';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';

/** A Round that completed a minute ago, its two debaters' lines frozen at revision 1. */
async function completedRound(
  fixture: Fixture,
  roundId: string,
  beforeFreeze?: (aff: { id: string; actorId: string }) => Promise<void>,
) {
  const [clock] = await fixture.sql`select clock_timestamp() as now`;
  const end = new Date(clock!.now.getTime() - 60_000);
  const start = new Date(end.getTime() - 1000);
  await fixture.sql.unsafe(
    "update rounds set status='completed',outcome='affirmative',started_at=$2,completed_at=$3,final_segment_ended_at=$3,transcript_admission_cutoff=$4 where id=$1",
    [roundId, start, end, new Date(end.getTime() + 120000)],
  );
  const aff = await fixture.seat(roundId, 'affirmative');
  const neg = await fixture.seat(roundId, 'negative');
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
    await fixture.sql`update rounds set status='active',current_stage='speech',completed_at=null,outcome=null where id=${roundId}`;
    await beforeFreeze(aff);
    await fixture.sql`update rounds set status='completed',current_stage=null,completed_at=${end},outcome='affirmative' where id=${roundId}`;
  }
  await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,2,'complete')`;
  return { aff };
}

/** A completed Round with its coaching store and a read of its coaching facts. */
export const withCompletedRound = (
  work: (value: {
    fixture: Fixture;
    roundId: string;
    client: SQL;
    aff: { id: string; actorId: string };
    jobs: ReturnType<typeof createRoundFeedbackJobs>;
    facts: () => ReturnType<typeof readRoundCoachingFacts>;
  }) => Promise<void>,
  beforeFreeze?: (
    fixture: Fixture,
    client: SQL,
    aff: { id: string; actorId: string },
  ) => Promise<void>,
) =>
  withBoundedRound(async (fixture, run, roundId, client) => {
    const { aff } = await completedRound(
      fixture,
      roundId,
      beforeFreeze ? (aff) => beforeFreeze(fixture, client, aff) : undefined,
    );
    await work({
      fixture,
      roundId,
      client,
      aff,
      jobs: createRoundFeedbackJobs({
        run,
        nextToken: () => randomBytes(32).toString('base64url'),
        leaseMs: 30000,
        model: 'anthropic/claude-sonnet-5.5',
      }),
      facts: () => readRoundCoachingFacts(drizzle({ client }), roundId),
    });
  });
