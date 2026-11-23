import { assert, test } from 'riteway/bun';
import { SQL } from 'bun';
import { rejectedBy } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
class RolledBack extends Error {}

test('TRUNCATE of any transcript table is refused (ISSUE-505)', async () => {
  const sql = new SQL(databaseUrl, { max: 1 });
  try {
    // One at a time, each in a transaction that never commits: were the guard
    // missing, nothing would be lost.
    const refused: (string | null)[] = [];
    for (const table of [
      'utterances',
      'round_transcripts',
      'round_transcript_freezes',
    ])
      refused.push(
        await rejectedBy(() =>
          sql.begin(async (tx) => {
            await tx.unsafe(`truncate ${table} cascade`);
            throw new RolledBack();
          }),
        ),
      );
    assert({
      given: 'TRUNCATE of utterances, round_transcripts and their freezes',
      should: 'refuse each by transcript_truncate_check',
      actual: refused,
      expected: Array.from({ length: 3 }, () => 'transcript_truncate_check'),
    });
  } finally {
    await sql.close();
  }
});
