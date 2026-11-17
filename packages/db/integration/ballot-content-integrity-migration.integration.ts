import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { Fixture } from './constraint-helpers';
import { frozenBallot } from './ballot-content.test-support';
import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'ballotcontent');
const migration = '20261116175854_tab_wiring';
afterAll(() => scratch.drop());
test(
  'ISSUE-1409: ballot_content_integrity backfills consumed content without rewriting ballots',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const client = new SQL(scratch.url, { max: 1 });
    try {
      const fixture = new Fixture(client);
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
      await client.begin(async (tx) => {
        await tx`insert into round_finalizations(round_id,command_id,resulting_version,freeze_revision) values(${roundId},${commandId},1,1)`;
        await tx`insert into round_finalization_ballots(round_id,ballot_id,freeze_revision) values(${roundId},${ballotId},1)`;
      });
      await scratch.migrate(() => true);
      const [row] =
        await client`select m.ballot_digest, daisy_ballot_content_digest(b) as actual, b.reason, b.winner from round_finalization_ballots m join ballots b on b.id=m.ballot_id where m.ballot_id=${ballotId}`;
      assert({
        given:
          'an existing finalization and its original submitted ballot before the migration',
        should: 'backfill the digest while preserving content',
        actual: row && [
          typeof row.ballot_digest === 'string' &&
            /^[a-f0-9]{64}$/.test(row.ballot_digest),
          row.ballot_digest === row.actual,
          row.reason,
          row.winner,
        ],
        expected: [true, true, 'The submitted reason.', 'affirmative'],
      });
      const [constraint] =
        await client`select convalidated from pg_constraint where conname='round_finalization_ballots_digest_check'`;
      assert({
        given: 'the validation folder after the backfill',
        should: 'leave the digest shape check validated',
        actual: constraint?.convalidated,
        expected: true,
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
