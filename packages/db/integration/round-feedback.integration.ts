import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { randomBytes } from 'node:crypto';
import { roundTranscriptPrivacyAdopter } from '../src/round-transcript-privacy';
import { withCompletedRound } from './round-feedback.test-support';
import type { Fixture } from './constraint-helpers';
setupRitewayBun();
requireTestServices(process.env);

const coaching = {
  affirmative: 'Weigh your access impact against their cost argument.',
  negative: 'Answer the access turn before you extend.',
};

const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();
const claim = () => 'claim' as const;
const lapse = (fixture: Fixture, roundId: string) =>
  fixture.sql`update round_feedback set lease_expires_at=clock_timestamp() - interval '1 second' where round_id=${roundId}`;

/** Erases one seated debater through the transcript privacy adopter. */
async function eraseDebater(client: SQL, actorId: string) {
  const [user] =
    (await client`select user_id from actors where id=${actorId}`) as {
      user_id: string;
    }[];
  await drizzle({ client }).transaction((tx) =>
    roundTranscriptPrivacyAdopter.erase(
      tx,
      { userId: user!.user_id, actorId },
      { now: new Date().toISOString() },
    ),
  );
}
const erased = {
  status: 'failed',
  attempts: 1,
  leaseExpiresAt: null,
  feedback: null,
} as const;

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
    await eraseDebater(client, aff.actorId);
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
        pass: erased,
        listed: false,
        retaken: null,
      },
    });
  }));

test('a frozen Round with no lines is never a candidate', async () =>
  withCompletedRound(async ({ fixture, roundId, jobs, facts }) => {
    await fixture.sql`delete from utterances where round_id=${roundId}`;
    assert({
      given: 'a completed, frozen Round with no transcript lines',
      should: 'not hold a scan batch place, and report no lines',
      actual: {
        listed: (await jobs.scan(64, dayAgo())).includes(roundId),
        lines: (await facts()).lines,
      },
      expected: { listed: false, lines: 0 },
    });
  }));

test('erasing a debater before coaching or during it ends coaching for good', async () => {
  await withCompletedRound(async ({ roundId, client, aff, jobs, facts }) => {
    await eraseDebater(client, aff.actorId);
    assert({
      given: 'a Round never coached whose debater is erased',
      should: 'leave a failed row with no text, never listed or claimed',
      actual: {
        pass: (await facts()).pass,
        listed: (await jobs.scan(64, dayAgo())).includes(roundId),
        claimed: await jobs.claim(roundId, claim),
      },
      expected: { pass: erased, listed: false, claimed: null },
    });
  });
  await withCompletedRound(async ({ roundId, client, aff, jobs, facts }) => {
    const held = await jobs.claim(roundId, claim);
    if (!held) throw Error('Expected a claim');
    await eraseDebater(client, aff.actorId);
    await assertRejects({
      given: 'a coaching call still running when its debater is erased',
      should: 'refuse its result with CONFLICT',
      actual: () => jobs.complete(roundId, held.token, coaching),
      code: 'CONFLICT',
    });
    assert({
      given: 'the erased Round',
      should: 'stay failed with no text',
      actual: (await facts()).pass,
      expected: erased,
    });
  });
});
