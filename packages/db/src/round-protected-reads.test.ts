import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readTranscriptSnapshot } from './round-protected-reads';
import { fakeSql } from './scripted-bun-wire';

setupRitewayBun();

test('the transcript snapshot reads its revision before any transcript rows', async () => {
  const { client, queries } = fakeSql([[], [], [], [], [], []]);
  const database = drizzle({ client });
  const snapshot = await database.transaction((tx) =>
    readTranscriptSnapshot(tx, 'r'.repeat(24)),
  );
  const order = queries
    .map(({ query }) =>
      [
        'round_transcripts',
        'round_transcript_freezes',
        'transcript_segments',
        'utterances',
      ].find((table) => new RegExp(`from "?${table}"?[\\s"]`).test(query)),
    )
    .filter((table) => table !== undefined);
  assert({
    given: 'a transcript read under READ COMMITTED',
    should:
      'take the counter first, so a write committed during the read can only make the rows newer than the revision',
    actual: { first: order[0], revision: snapshot.revision },
    expected: { first: 'round_transcripts', revision: 0 },
  });
});
