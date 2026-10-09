import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();
test('username intent resolves only a current bound human actor', async () => {
  const actorId = 'a'.repeat(24);
  const { database, queries } = createTestDatabase([[[actorId]], []]);
  assert({
    given: 'a canonical username and an absent public identity',
    should: 'return only the actor identifier or null without granting access',
    actual: [
      await database.lookupHumanActorByUsername(' Ada_One '),
      await database.lookupHumanActorByUsername('absent'),
    ],
    expected: [actorId, null],
  });
  const query = queries[0]!;
  assert({
    given: 'a public username discovery query',
    should:
      'bind normalized input and restrict current verified human accounts',
    actual: [
      query.params,
      query.query.includes('"deleted_at" is null'),
      query.query.includes('"email_verified" ='),
      query.query.includes('"kind" ='),
      query.query.startsWith('select "actors"."id"'),
    ],
    expected: [['ada_one', 'human', true, 1], true, true, true, true],
  });
});
test('malformed username intent is rejected before database I/O', async () => {
  const { database, queries } = createTestDatabase([]);
  await assertRejects({
    given: 'a non-ASCII username',
    should: 'reject at the boundary',
    actual: () => database.lookupHumanActorByUsername('Kelvin'),
    code: 'VALIDATION',
  });
  assert({
    given: 'rejected lookup input',
    should: 'perform no SQL',
    actual: queries.length,
    expected: 0,
  });
});
