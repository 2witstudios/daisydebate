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

test('discovered actor resolution selects only the active human user binding', async () => {
  const actorId = 'a'.repeat(24);
  const userId = 'u'.repeat(24);
  const { database, queries } = createTestDatabase([[[userId]], []]);
  assert({
    given: 'a discovered actor with a current account and an absent actor',
    should: 'resolve only the internal user binding or null',
    actual: [
      await database.getActiveHumanUserIdByActorId(actorId),
      await database.getActiveHumanUserIdByActorId('b'.repeat(24)),
    ],
    expected: [userId, null],
  });
  const query = queries[0]!;
  assert({
    given: 'the internal actor-to-user lookup',
    should:
      'select only its user binding while rechecking the verified active human account',
    actual: [
      query.params,
      query.query.startsWith('select "actors"."user_id"'),
      query.query.includes('"deleted_at" is null'),
      query.query.includes('"email_verified" ='),
      query.query.includes('"kind" ='),
    ],
    expected: [[actorId, 'human', true, 1], true, true, true, true],
  });
});
