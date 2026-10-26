import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { randomBytes } from 'node:crypto';
import {
  createRoundFeedbackJobs,
  readRoundCoachingFacts,
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
    facts: () => ReturnType<typeof readRoundCoachingFacts>;
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
      facts: () => readRoundCoachingFacts(drizzle({ client }), roundId),
    });
  });

const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();
const claim = () => 'claim' as const;
const lapse = (fixture: Fixture, roundId: string) =>
  fixture.sql`update round_feedback set lease_expires_at=clock_timestamp() - interval '1 second' where round_id=${roundId}`;

test('a completed Round is coached once from its freeze, under one lease at a time', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    const before = {
      listed: (await jobs.scan(64, dayAgo())).includes(roundId),
      recent: (await jobs.scan(64, new Date().toISOString())).includes(roundId),
      facts: await facts(),
    };
    const first = await jobs.claim(roundId, claim);
    const held = await facts();
    if (!first) throw Error('Expected a claim');
    await assertRejects({
      given: 'a token that does not hold the lease',
      should: 'refuse the result with CONFLICT',
      actual: () =>
        jobs.complete(roundId, randomBytes(32).toString('base64url'), coaching),
      code: 'CONFLICT',
    });
    await jobs.recordUsage(roundId, first.token, {
      inputTokens: 900,
      outputTokens: 80,
    });
    await jobs.complete(roundId, first.token, coaching);
    const [row] =
      await fixture.sql`select status,attempts,freeze_revision,input_tokens,output_tokens,lease_token_digest from round_feedback where round_id=${roundId}`;
    assert({
      given: 'a completed Round with frozen lines and no AI ballot',
      should:
        'list it only from a window that holds it, read its plain facts, let a claim read its freeze, and store both sides’ coaching with its usage',
      actual: {
        before: {
          listed: before.listed,
          recent: before.recent,
          frozen: before.facts.frozen,
          lines: before.facts.lines,
          pass: before.facts.pass,
        },
        claimed: {
          lines: first.frozen.utterances.length,
          revision: first.frozen.revision,
          held: held.pass?.status,
        },
        row,
        after: {
          listed: (await jobs.scan(64, dayAgo())).includes(roundId),
          retaken: await jobs.claim(roundId, claim),
          pass: (await facts()).pass?.feedback,
        },
      },
      expected: {
        before: {
          listed: true,
          recent: false,
          frozen: true,
          lines: 2,
          pass: null,
        },
        claimed: { lines: 2, revision: 1, held: 'leased' },
        row: {
          status: 'succeeded',
          attempts: 1,
          freeze_revision: 1,
          input_tokens: 900,
          output_tokens: 80,
          lease_token_digest: null,
        },
        after: { listed: false, retaken: null, pass: coaching },
      },
    });
  }));

test('a lapsed lease is listed again and the decision retakes or ends it', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    await jobs.claim(roundId, claim);
    await lapse(fixture, roundId);
    const listed = (await jobs.scan(64, new Date().toISOString())).includes(
      roundId,
    );
    const second = await jobs.claim(roundId, claim);
    await lapse(fixture, roundId);
    const ended = await jobs.claim(roundId, () => 'fail');
    const [row] =
      await fixture.sql`select status,attempts,lease_token_digest from round_feedback where round_id=${roundId}`;
    assert({
      given: 'a lapsed first attempt, retaken, then lapsed and ended',
      should:
        'list it whatever its age, take a second attempt, then end the job failed',
      actual: {
        listed,
        attempt: second?.attempt,
        ended,
        row,
        facts: (await facts()).pass?.status,
      },
      expected: {
        listed: true,
        attempt: 2,
        ended: null,
        row: { status: 'failed', attempts: 2, lease_token_digest: null },
        facts: 'failed',
      },
    });
  }));

test('a Round without a frozen transcript is never a candidate', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    await fixture.sql`delete from round_transcript_freezes where round_id=${roundId}`;
    assert({
      given: 'a completed Round with lines but no freeze',
      should: 'not list it, and report it unfrozen',
      actual: {
        listed: (await jobs.scan(64, dayAgo())).includes(roundId),
        frozen: (await facts()).frozen,
      },
      expected: { listed: false, frozen: false },
    });
  }));

test('erasing a debater clears their Round’s coaching for good', async () =>
  withCompletedRound(async ({ roundId, client, aff, jobs, facts }) => {
    const first = await jobs.claim(roundId, claim);
    if (!first) throw Error('Expected a claim');
    await jobs.complete(roundId, first.token, coaching);
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
        'drop the coaching text and leave the job failed, so it is never listed or bought again',
      actual: {
        pass: (await facts()).pass,
        listed: (await jobs.scan(64, dayAgo())).includes(roundId),
        retaken: await jobs.claim(roundId, claim),
      },
      expected: {
        pass: {
          status: 'failed',
          attempts: 1,
          leaseExpiresAt: null,
          feedback: null,
        },
        listed: false,
        retaken: null,
      },
    });
  }));
