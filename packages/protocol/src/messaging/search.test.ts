import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingCoreSchemas } from './core';
setupRitewayBun();
test('channel search validates its exact scope and bounded literal text before reading', () => {
  const channelId = 'a'.repeat(24);
  const schemas = createMessagingCoreSchemas({
    messageUnits: 20,
    pageItems: 3,
  });
  const input = { version: 1, channelId, query: '%_ literal', limit: 2 };
  assert({
    given: 'a bounded literal search',
    should: 'preserve its text as data',
    actual: schemas.search.parse(input),
    expected: input,
  });
  for (const patch of [
    { query: '' },
    { query: ' ' },
    { query: 'x'.repeat(21) },
    { limit: 4 },
    { before: { channelId: 'b'.repeat(24), sequence: 1 } },
    { actorId: channelId },
  ]) {
    assert({
      given: 'invalid bounds, foreign cursor or caller authority fields',
      should: 'refuse before a database read',
      actual: schemas.search.safeParse({ ...input, ...patch }).success,
      expected: false,
    });
  }
});
