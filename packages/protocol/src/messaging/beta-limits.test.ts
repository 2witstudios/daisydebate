import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingCoreSchemas, messagingBetaLimits } from '../index';

setupRitewayBun();

const bounds = {
  messageUnits: messagingBetaLimits.messageUnits,
  pageItems: messagingBetaLimits.pageItems,
};
const schemas = createMessagingCoreSchemas(bounds);
const channelId = 'c'.repeat(24);

test('DEC-124 beta limits cap every injected core bound', () => {
  assert({
    given: 'the confirmed beta size policy',
    should: 'state its exact UTF-16, page, batch and body limits',
    actual: messagingBetaLimits,
    expected: {
      messageUnits: 4000,
      introductionUnits: 500,
      titleUnits: 80,
      queryUnits: 200,
      pageItems: 100,
      batchActors: 50,
      bodyBytes: 65536,
    },
  });
  assert({
    given: 'core bounds at the beta limits',
    should: 'compose',
    actual: Object.keys(createMessagingCoreSchemas(bounds)).includes('send'),
    expected: true,
  });
  for (const over of [
    { ...bounds, messageUnits: 4001 },
    { ...bounds, pageItems: 101 },
  ])
    assert({
      given: `a bound above the beta limit: ${JSON.stringify(over)}`,
      should: 'refuse to compose the schemas',
      actual: (() => {
        try {
          createMessagingCoreSchemas(over);
          return 'composed';
        } catch {
          return 'refused';
        }
      })(),
      expected: 'refused',
    });
});

test('search queries are 1–200 UTF-16 units however long a message may be', () => {
  const search = { version: 1, channelId, limit: 1 };
  const cases = [
    ['q', true],
    ['q'.repeat(200), true],
    ['😀'.repeat(100), true],
    ['q'.repeat(201), false],
    ['😀'.repeat(100) + 'q', false],
    ['', false],
    ['  ', false],
  ] as const;
  for (const [query, expected] of cases)
    assert({
      given: `a ${query.length}-unit query`,
      should: expected ? 'accept it unchanged' : 'refuse it',
      actual: schemas.search.safeParse({ ...search, query }).success,
      expected,
    });
});
