import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingSocialSchemas } from './social';
setupRitewayBun();
test('native management username intent validates operation-specific target without grants', () => {
  const schema = createMessagingSocialSchemas({
    batchActors: 3,
    titleUnits: 30,
    introductionUnits: 30,
  }).manageGroupUsername;
  const base = {
    version: 1,
    requestId: 'r'.repeat(24),
    channelId: 'c'.repeat(24),
  };
  assert({
    given: 'group management intents and malformed targets',
    should: 'validate exact portable operation fields before discovery',
    actual: [
      schema.safeParse({
        ...base,
        operation: 'remove',
        memberUsername: 'Member_1',
      }).success,
      schema.safeParse({
        ...base,
        operation: 'transfer',
        memberUsername: 'Member_1',
      }).success,
      schema.safeParse({ ...base, operation: 'leave' }).success,
      schema.safeParse({ ...base, operation: 'archive' }).success,
      schema.safeParse({ ...base, operation: 'remove' }).success,
      schema.safeParse({
        ...base,
        operation: 'leave',
        memberUsername: 'Member_1',
      }).success,
      schema.safeParse({ ...base, operation: 'invite' }).success,
    ],
    expected: [true, true, true, true, false, false, false],
  });
});
