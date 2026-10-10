import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingSocialSchemas } from './social';
setupRitewayBun();
test('invitation transitions require the exact observed generation without client grants', () => {
  const schema = createMessagingSocialSchemas({
    introductionUnits: 40,
    titleUnits: 30,
    batchActors: 4,
  });
  const command = {
    version: 1,
    channelId: 'c'.repeat(24),
    requestId: 'r'.repeat(24),
    decision: 'accept',
  };
  for (const [expectedGeneration, valid] of [
    [undefined, false],
    [0, false],
    [-1, false],
    [1, true],
    [Number.MAX_SAFE_INTEGER + 1, false],
  ] as const) {
    assert({
      given: `an invitation generation ${expectedGeneration}`,
      should: 'require a positive safe observed generation',
      actual: schema.decideGroupInvitation.safeParse({
        ...command,
        ...(expectedGeneration === undefined ? {} : { expectedGeneration }),
      }).success,
      expected: valid,
    });
  }
  assert({
    given: 'a claimed grant in a valid invitation decision',
    should: 'reject fabricated membership',
    actual: schema.decideGroupInvitation.safeParse({
      ...command,
      expectedGeneration: 1,
      role: 'manager',
    }).success,
    expected: false,
  });
});
test('invitation cancellation and minimal results stay closed and channel-scoped', () => {
  const schemas = createMessagingSocialSchemas({
    introductionUnits: 40,
    titleUnits: 30,
    batchActors: 4,
  });
  const channelId = 'c'.repeat(24);
  const command = {
    version: 1,
    channelId,
    requestId: 'r'.repeat(24),
    inviteeActorId: 'i'.repeat(24),
    expectedGeneration: 2,
  };
  assert({
    given: 'an original inviter intent',
    should:
      'transport target and observed generation without granting authority',
    actual: schemas.cancelGroupInvitation.parse(command),
    expected: command,
  });
  const result = { version: 1, channelId, generation: 2, state: 'cancelled' };
  assert({
    given: 'an authorized closed minimal result',
    should: 'contain no grant or channel content',
    actual: schemas.invitationResult.safeParse(result).success,
    expected: true,
  });
  for (const extra of [
    { title: 'private' },
    { memberActorIds: ['i'.repeat(24)] },
    { role: 'member' },
  ]) {
    assert({
      given: 'content or membership attached to a minimal receipt result',
      should: 'refuse the extra disclosure',
      actual: schemas.invitationResult.safeParse({ ...result, ...extra })
        .success,
      expected: false,
    });
  }
});
