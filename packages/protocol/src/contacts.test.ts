import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  contactBlockResultSchema,
  contactBlockSchema,
  contactBlockUsernameSchema,
} from './index';

setupRitewayBun();
const actorId = 'a'.repeat(24);
const requestId = 'r'.repeat(24);

test('safety block commands cannot forge the blocking actor or durable facts', () => {
  const command = {
    version: 1,
    requestId,
    otherActorId: actorId,
    blocked: true,
  };
  assert({
    given: 'an explicit participant safety choice',
    should:
      'validate the subject actor and boolean without channel or age claims',
    actual: contactBlockSchema.safeParse(command).success,
    expected: true,
  });
  for (const patch of [
    { blocked: 'true' },
    { blockerActorId: actorId },
    { ageBand: 'adult' },
    { revision: 1 },
  ])
    assert({
      given: JSON.stringify(patch),
      should: 'refuse caller-supplied authority',
      actual: contactBlockSchema.safeParse({ ...command, ...patch }).success,
      expected: false,
    });
});

test('a block by username normalizes the name and forbids caller-granted authority', () => {
  const base = { version: 1, requestId, username: 'Peer_Name', blocked: true };
  assert({
    given: 'a block by a mixed-case username',
    should: 'use the single canonical username',
    actual: contactBlockUsernameSchema.parse(base).username,
    expected: 'peer_name',
  });
  for (const patch of [
    { username: 'bad username' },
    { otherActorId: actorId },
    { version: 2 },
  ])
    assert({
      given: JSON.stringify(patch),
      should: 'refuse an invalid name or a caller-supplied identity',
      actual: contactBlockUsernameSchema.safeParse({ ...base, ...patch })
        .success,
      expected: false,
    });
});

test('a block result reports only the caller’s choice and the pair revision', () => {
  assert({
    given: 'a result with an extra field',
    should: 'refuse it: the contract is exactly version, blocked and revision',
    actual: [
      contactBlockResultSchema.safeParse({
        version: 1,
        blocked: true,
        revision: 2,
      }).success,
      contactBlockResultSchema.safeParse({
        version: 1,
        blocked: true,
        revision: 2,
        otherActorId: actorId,
      }).success,
    ],
    expected: [true, false],
  });
});
