import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { drawQuerySchema } from './draw-read';
import { entryListQuerySchema, judgeListQuerySchema } from './entry-read';
import { postingQuerySchema } from './posting-read';
import { tabRoundQuerySchema, timeSlotQuerySchema } from './tab-round-read';
setupRitewayBun();
describe('queries for Tab screens at scale', () => {
  test('search and paging stay bounded at the boundary', () => {
    const schemas = [
      drawQuerySchema,
      entryListQuerySchema,
      judgeListQuerySchema,
      postingQuerySchema,
      tabRoundQuerySchema,
      timeSlotQuerySchema,
    ];
    assert({
      given:
        'a valid page, a negative offset, an unbounded page and a very long query',
      should: 'accept only the valid query for every screen',
      actual: schemas.map((schema) =>
        [
          { q: 'Hartwell', offset: 20, pageSize: 20 },
          { offset: -1 },
          { pageSize: 501 },
          { q: 'x'.repeat(81) },
        ].map((query) => schema.safeParse(query).success),
      ),
      expected: schemas.map(() => [true, false, false, false]),
    });
  });
  test('a status belongs to its own screen', () => {
    assert({
      given: 'room, entry and judge filters, including the wrong screen status',
      should: 'keep statuses in their own vocabulary',
      actual: [
        tabRoundQuerySchema.safeParse({ status: 'judging' }).success,
        entryListQuerySchema.safeParse({ status: 'not_answered' }).success,
        judgeListQuerySchema.safeParse({ status: 'conflict' }).success,
        entryListQuerySchema.safeParse({ status: 'judging' }).success,
        judgeListQuerySchema.safeParse({ status: 'not_answered' }).success,
      ],
      expected: [true, true, true, false, false],
    });
  });
});
