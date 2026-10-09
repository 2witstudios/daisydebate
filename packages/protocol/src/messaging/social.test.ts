import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createMessagingSocialSchemas,
  type MessagingSocialBounds,
} from '../index';

setupRitewayBun();
const bounds: MessagingSocialBounds = {
  introductionUnits: 500,
  titleUnits: 80,
  batchActors: 50,
};
const schemas = createMessagingSocialSchemas(bounds);
const actorId = 'a'.repeat(24);
const requestId = 'r'.repeat(24);
const channelId = 'c'.repeat(24);

test('DM requests carry no caller-supplied identity or eligibility', () => {
  const valid = {
    version: 1,
    requestId,
    recipientActorId: actorId,
    introduction: ' Hello ',
  };
  assert({
    given: 'an introduction with whitespace',
    should: 'preserve text',
    actual: schemas.requestDm.parse(valid).introduction,
    expected: ' Hello ',
  });
  for (const [patch, expected] of [
    [{ introduction: 'a'.repeat(500) }, true],
    [{ introduction: 'a'.repeat(501) }, false],
    [{ introduction: ' ' }, false],
    [{ recipientActorId: 'invalid' }, false],
    [{ senderActorId: actorId }, false],
    [{ ageBand: 'adult' }, false],
    [{ friend: true }, false],
  ] as const)
    assert({
      given: JSON.stringify(patch),
      should: 'validate DM transport without deciding entitlement',
      actual: schemas.requestDm.safeParse({ ...valid, ...patch }).success,
      expected,
    });
});

test('group creation bounds work and rejects duplicate members', () => {
  const valid = {
    version: 1,
    requestId,
    title: ' Group ',
    invitedActorIds: [actorId],
  };
  for (const [patch, expected] of [
    [{ title: 'a'.repeat(80) }, true],
    [{ title: 'a'.repeat(81) }, false],
    [{ title: '\t' }, false],
    [{ invitedActorIds: [] }, false],
    [{ invitedActorIds: [actorId, actorId] }, false],
    [{ invitedActorIds: ['bad'] }, false],
    [
      {
        invitedActorIds: Array.from(
          { length: 50 },
          (_, i) => `a${String(i).padStart(23, '0')}`,
        ),
      },
      true,
    ],
    [
      {
        invitedActorIds: Array.from(
          { length: 51 },
          (_, i) => `a${String(i).padStart(23, '0')}`,
        ),
      },
      false,
    ],
    [{ grants: ['manager'] }, false],
  ] as const)
    assert({
      given: JSON.stringify(patch),
      should: 'validate group work bounds without granting membership',
      actual: schemas.createGroup.safeParse({ ...valid, ...patch }).success,
      expected,
    });
});

test('social decisions bind a versioned request to its resource', () => {
  const valid = { version: 1, requestId, channelId, decision: 'accept' };
  for (const decision of ['accept', 'decline', 'cancel', 'unknown'])
    assert({
      given: decision,
      should: 'accept only explicit DM transitions',
      actual: schemas.decideDm.safeParse({ ...valid, decision }).success,
      expected: decision !== 'unknown',
    });
  assert({
    given: 'a forged principal',
    should: 'refuse unknown decision fields',
    actual: schemas.decideDm.safeParse({ ...valid, actorId }).success,
    expected: false,
  });
});

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
    actual: schemas.block.safeParse(command).success,
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
      actual: schemas.block.safeParse({ ...command, ...patch }).success,
      expected: false,
    });
});
