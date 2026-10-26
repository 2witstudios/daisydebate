import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { randomBytes } from 'node:crypto';
import {
  createRoundFeedbackJobs,
  readRoundFeedbackFacts,
} from '../src/round-feedback';
import { roundTranscriptPrivacyAdopter } from '../src/round-transcript-privacy';
import { withBoundedRound } from './bounded-transaction.test-support';
import type { Fixture } from './constraint-helpers';
setupRitewayBun();
requireTestServices(process.env);

const coaching = {
  affirmative: 'Weigh your access impact against their cost argument.',
  negative: 'Answer the access turn before you extend.',
};

/** A Round that completed a minute ago, its two debaters' lines frozen at revision 1. */
async function completedRound(fixture: Fixture, roundId: string) {
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
  await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,2,'complete')`;
  return { aff };
}

/** A completed Round with its coaching store and a read of its coaching facts. */
const withCompletedRound = (
  work: (value: {
    fixture: Fixture;
    roundId: string;
    client: SQL;
    aff: { id: string; actorId: string };
    jobs: ReturnType<typeof createRoundFeedbackJobs>;
    facts: () => ReturnType<typeof readRoundFeedbackFacts>;
  }) => Promise<void>,
) =>
  withBoundedRound(async (fixture, run, roundId, client) => {
    const { aff } = await completedRound(fixture, roundId);
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
      facts: () => readRoundFeedbackFacts(drizzle({ client }), roundId),
    });
  });

test('a completed Round is coached once from its freeze, under one lease at a time', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    const before = await jobs.scan(64);
    const claim = await jobs.claim(roundId);
    const held = await jobs.claim(roundId);
    if (!claim) throw Error('Expected a claim');
    await assertRejects({
      given: 'a token that does not hold the lease',
      should: 'refuse the result with CONFLICT',
      actual: () =>
        jobs.complete(roundId, randomBytes(32).toString('base64url'), coaching),
      code: 'CONFLICT',
    });
    await jobs.recordUsage(roundId, claim.token, {
      inputTokens: 900,
      outputTokens: 80,
    });
    await jobs.complete(roundId, claim.token, coaching);
    const [row] =
      await fixture.sql`select status,attempts,freeze_revision,input_tokens,output_tokens,lease_token_digest from round_feedback where round_id=${roundId}`;
    assert({
      given: 'a completed Round with frozen lines and no AI ballot',
      should:
        'list it, let one claim read its freeze, hold off a second, and store both sides’ coaching with its usage',
      actual: {
        listed: before.includes(roundId),
        frozen: claim.frozen.utterances.length,
        revision: claim.frozen.revision,
        held,
        row,
        after: (await jobs.scan(64)).includes(roundId),
        facts: await facts(),
      },
      expected: {
        listed: true,
        frozen: 2,
        revision: 1,
        held: null,
        row: {
          status: 'succeeded',
          attempts: 1,
          freeze_revision: 1,
          input_tokens: 900,
          output_tokens: 80,
          lease_token_digest: null,
        },
        after: false,
        facts: { status: 'succeeded', feedback: coaching, eligible: true },
      },
    });
  }));

test('a Round buys at most two paid calls, then fails', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    const lapse = () =>
      fixture.sql`update round_feedback set lease_expires_at=clock_timestamp() - interval '1 second' where round_id=${roundId}`;
    const first = await jobs.claim(roundId);
    await lapse();
    const second = await jobs.claim(roundId);
    await lapse();
    const third = await jobs.claim(roundId);
    await jobs.scan(64);
    const [row] =
      await fixture.sql`select status,attempts,lease_token_digest from round_feedback where round_id=${roundId}`;
    assert({
      given: 'two claims whose leases lapsed without a result',
      should:
        'refuse a third claim and end the job failed once a scan finds it spent',
      actual: {
        attempts: [first?.attempt, second?.attempt],
        third,
        row,
        facts: (await facts()).status,
      },
      expected: {
        attempts: [1, 2],
        third: null,
        row: { status: 'failed', attempts: 2, lease_token_digest: null },
        facts: 'failed',
      },
    });
  }));

test('a Round without a frozen transcript is never coached', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    await fixture.sql`delete from round_transcript_freezes where round_id=${roundId}`;
    assert({
      given: 'a completed Round with lines but no freeze',
      should: 'neither list nor claim it, and report it ineligible',
      actual: {
        listed: (await jobs.scan(64)).includes(roundId),
        claim: await jobs.claim(roundId),
        facts: await facts(),
      },
      expected: {
        listed: false,
        claim: null,
        facts: { status: null, feedback: null, eligible: false },
      },
    });
  }));

test('a lapsed lease ends failed once its Round leaves the coaching window', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    await jobs.claim(roundId);
    await fixture.sql`update rounds set completed_at=clock_timestamp() - interval '25 hours', started_at=clock_timestamp() - interval '26 hours', final_segment_ended_at=clock_timestamp() - interval '25 hours' where id=${roundId}`;
    await fixture.sql`update round_feedback set lease_expires_at=clock_timestamp() - interval '1 second' where round_id=${roundId}`;
    await jobs.scan(64);
    assert({
      given: 'one lapsed attempt with a call left, after the 24-hour window',
      should: 'end the job failed instead of leaving it pending forever',
      actual: (await facts()).status,
      expected: 'failed',
    });
  }));

test('erasing a debater clears their Round’s coaching for good', async () =>
  withCompletedRound(async ({ roundId, client, aff, jobs, facts }) => {
    const claim = await jobs.claim(roundId);
    if (!claim) throw Error('Expected a claim');
    await jobs.complete(roundId, claim.token, coaching);
    const database = drizzle({ client });
    const [user] =
      (await client`select user_id from actors where id=${aff.actorId}`) as {
        user_id: string;
      }[];
    await database.transaction((tx) =>
      roundTranscriptPrivacyAdopter.erase(
        tx,
        { userId: user!.user_id, actorId: aff.actorId },
        { now: new Date().toISOString() },
      ),
    );
    assert({
      given:
        'a coached Round one of whose debaters is erased within the window',
      should:
        'drop the coaching text and leave the job failed so it is never bought again',
      actual: {
        facts: await facts(),
        listed: (await jobs.scan(64)).includes(roundId),
        claim: await jobs.claim(roundId),
      },
      expected: {
        facts: { status: 'failed', feedback: null, eligible: true },
        listed: false,
        claim: null,
      },
    });
  }));
