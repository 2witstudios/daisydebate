import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { fakeSql } from './scripted-bun-wire';

setupRitewayBun();
const roundId = 'r'.repeat(24);
const freezeRow = (frontier: number) => [
  roundId,
  1,
  frontier,
  new Date('2026-10-26T00:00:00.000Z'),
  'complete',
];

test('a frozen transcript rejects a mismatched durable frontier (ISSUE-505)', async () => {
  const { client } = fakeSql([[freezeRow(7)], [[8]], [], []]);
  await assertRejects({
    given: 'a freeze at frontier 7 but durable transcript revision 8',
    should: 'refuse inconsistent judging input',
    code: 'INVARIANT',
    actual: () => readLockedFrozenRoundTranscript(drizzle({ client }), roundId),
  });
});

for (const revision of [0, 7])
  test(`frozen frontier ${revision} remains valid after lawful line erasure`, async () => {
    const { client } = fakeSql([
      [freezeRow(revision)],
      revision ? [[revision]] : [],
      [],
      [],
    ]);
    const frozen = await readLockedFrozenRoundTranscript(
      drizzle({ client }),
      roundId,
    );
    assert({
      given: 'a matching immutable frontier with no remaining transcript lines',
      should: 'compare the durable revision rather than the line count',
      actual: frozen && { frontier: frozen.frontier, lines: frozen.utterances },
      expected: { frontier: revision, lines: [] },
    });
  });
