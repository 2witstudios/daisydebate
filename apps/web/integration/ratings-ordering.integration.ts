import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { chained, inArena, minute } from './ratings-arena';

requireTestServices(process.env);
setupRitewayBun();

describe('rating order with the engine decision (RATE-1.3)', () => {
  test('loses no rating when debates sharing a debater are rated concurrently', async () => {
    await inArena(async ({ actor, debate, rate, ledger }) => {
      for (let round = 0; round < 8; round += 1) {
        const shared = await actor();
        const earlier = await debate({
          affirmative: shared,
          negative: await actor(),
          outcome: 'affirmative',
          completedAt: minute(30),
        });
        const later = await debate({
          affirmative: shared,
          negative: await actor(),
          outcome: 'affirmative',
          completedAt: minute(40),
        });
        const kinds = (await Promise.all([rate(later), rate(earlier)])).map(
          ({ kind }) => kind,
        );
        const rows = await ledger(shared);
        assert({
          given: `round ${round}: two debates won by one debater, rated concurrently`,
          should:
            'rate both and keep that debater ledger chained in posting order',
          actual: { kinds, postings: rows.length, chained: chained(rows) },
          expected: { kinds: ['rated', 'rated'], postings: 2, chained: true },
        });
      }
    });
  });

  test('rates a delayed earlier debate after a later one, posted just after it', async () => {
    await inArena(async ({ actor, debate, rate, ledger }) => {
      const shared = await actor();
      const earlier = await debate({
        affirmative: shared,
        negative: await actor(),
        completedAt: minute(30),
      });
      const later = await debate({
        affirmative: shared,
        negative: await actor(),
        completedAt: minute(40),
      });
      await rate(later);
      const delayed = await rate(earlier);
      const rows = await ledger(shared);
      assert({
        given: 'the earlier-completed debate rated only after the later one',
        should:
          'rate it, posted one millisecond after the later posting, with the ledger chained',
        actual: {
          kind: delayed.kind,
          order: rows.map(({ debate_id }) => debate_id),
          postedAt: rows[1]?.occurred_at.toISOString(),
          chained: chained(rows),
        },
        expected: {
          kind: 'rated',
          order: [later, earlier],
          postedAt: '2026-10-05T12:40:00.001Z',
          chained: true,
        },
      });
    });
  });
});
