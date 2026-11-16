import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { recordedEnding, recordedEndingJoins } from '../src/recorded-ending';
import { frozenBallot, runtimeRefusal } from './ballot-content.test-support';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('ISSUE-1409: the runtime cannot rewrite or delete a submitted ballot', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { ballotId } = await frozenBallot(fixture);
    const mutations = [
      "update ballots set winner='negative' where id=$1 returning id",
      "update ballots set scores='{}'::jsonb where id=$1 returning id",
      "update ballots set reason='A rewritten reason' where id=$1 returning id",
      'update ballots set feedback=\'{"affirmative":"Rewritten feedback"}\'::jsonb where id=$1 returning id',
      'update ballots set citations=\'{"affirmative":{"turn":"a","note":"Rewritten citation"}}\'::jsonb where id=$1 returning id',
      'delete from ballots where id=$1 returning id',
    ];
    const refusals = [];
    for (const mutation of mutations)
      refusals.push(await runtimeRefusal(fixture, mutation, ballotId));
    assert({
      given: 'the real runtime role and a submitted ballot in its own lobby',
      should:
        'refuse winner, scores, reason, feedback, citations and direct deletion at the database',
      actual: refusals,
      expected: mutations.map(() => '42501'),
    });
  });
});

test('ISSUE-1409: finalization pins each consumed ballot content digest', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const { roundId, ballotId, judge } = await frozenBallot(fixture);
    const commandId = createId();
    await fixture.insert(
      'round_commands',
      {
        command_id: commandId,
        round_id: roundId,
        actor_id: judge.actorId,
        type: 'complete',
        payload_digest: 'a'.repeat(64),
        result: {},
        resulting_version: 1,
        applied_at: new Date(2000),
      },
      'command_id',
    );
    await fixture.sql.begin(async (tx) => {
      await tx`insert into round_finalizations(round_id,command_id,resulting_version,freeze_revision) values(${roundId},${commandId},1,1)`;
      await tx`insert into round_finalization_ballots(round_id,ballot_id,freeze_revision) values(${roundId},${ballotId},1)`;
    });
    const [membership] =
      await fixture.sql`select m.ballot_digest, daisy_ballot_content_digest(b) as actual from round_finalization_ballots m join ballots b on b.id=m.ballot_id where m.ballot_id=${ballotId}`;
    assert({
      given: 'a finalization consuming the original submitted ballot',
      should: 'pin its canonical content digest',
      actual: membership && [
        typeof membership.ballot_digest === 'string' &&
          /^[a-f0-9]{64}$/.test(membership.ballot_digest),
        membership.ballot_digest === membership.actual,
      ],
      expected: [true, true],
    });
    const database = drizzle({ client: fixture.sql });
    const original = await database.execute(
      sql`select ${recordedEnding} as ending from rounds r ${recordedEndingJoins} where r.id=${roundId}`,
    );
    assert({
      given: 'the consumed content still matching its pinned digest',
      should: 'retain a judged recorded ending',
      actual: original[0]?.ending,
      expected: 'judged',
    });
    // A migration-owner corruption of the stored digest is repaired in the same transaction; no trigger is disabled.
    await fixture.sql.begin(async (tx) => {
      await tx`update round_finalization_ballots set ballot_digest=case when left(ballot_digest,1)='a' then 'b' else 'a' end || substring(ballot_digest from 2) where ballot_id=${ballotId}`;
      const changed = await drizzle({ client: tx }).execute(
        sql`select ${recordedEnding} as ending from rounds r ${recordedEndingJoins} where r.id=${roundId}`,
      );
      assert({
        given:
          'a stored content digest that no longer matches the submitted ballot',
        should: 'detect the mismatch before the ending can be rated',
        actual: changed[0]?.ending,
        expected: 'unrecorded',
      });
      await tx`update round_finalization_ballots set ballot_digest=daisy_ballot_content_digest(b) from ballots b where b.id=round_finalization_ballots.ballot_id and b.id=${ballotId}`;
    });
    const erased = await runtimeRefusal(
      fixture,
      'delete from rounds where id=$1 returning id',
      roundId,
    );
    assert({
      given: 'owning Round aggregate erasure under the runtime role',
      should:
        'keep the cascade legal despite direct ballot deletion being closed',
      actual: erased,
      expected: null,
    });
  });
});
