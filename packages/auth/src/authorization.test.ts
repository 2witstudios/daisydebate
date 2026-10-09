import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
setupRitewayBun();
const input: AuthorizationInput = {
  principal: { kind: 'user', userId: 'u', actorId: 'a' },
  capability: 'room.read',
  context: {
    account: {
      userId: 'u',
      actorId: 'a',
      member: true,
      erased: false,
      revision: 1,
    },
  },
  resource: {
    kind: 'room',
    roomId: 'r',
    hostActorId: 'host',
    visibility: 'private',
    status: 'assembling',
    revision: 1,
    participants: [],
  },
};
describe('canonical authorization', () => {
  test('private read, host and seat locality', () => {
    const resource = input.resource;
    if (resource.kind !== 'room') throw new Error('Room fixture required');
    assert({
      given: 'private, public, hosted and seated rooms',
      should: 'allow only current eligible readers',
      actual: [
        authorize(input).allow,
        authorize({ ...input, resource: { ...resource, visibility: 'public' } })
          .allow,
        authorize({ ...input, resource: { ...resource, hostActorId: 'a' } })
          .allow,
        authorize({
          ...input,
          resource: {
            ...resource,
            participants: [{ actorId: 'a', role: 'debater', slot: 0 }],
          },
        }).allow,
      ],
      expected: [false, true, true, true],
    });
  });
  test('account binding and erasure dominate', () => {
    assert({
      given: 'erased, foreign, missing or provisional account facts',
      should: 'refuse every room capability',
      actual: ['room.read', 'room.manage', 'room.ready', 'room.leave'].flatMap(
        (capability) =>
          [
            { ...input.context.account!, erased: true },
            { ...input.context.account!, userId: 'other' },
            null,
            { ...input.context.account!, member: false },
          ].map(
            (account) =>
              authorize({
                ...input,
                capability: capability as AuthorizationInput['capability'],
                context: { account },
              }).allow,
          ),
      ),
      expected: Array(16).fill(false),
    });
  });
  test('resource kinds are checked first', () => {
    assert({
      given: 'channel capability on a room',
      should: 'deny the invalid pair',
      actual: authorize({ ...input, capability: 'channel.read' }),
      expected: { allow: false, reason: 'denied' },
    });
  });
  test('seating never gives host authority', () => {
    const resource = input.resource;
    if (resource.kind !== 'room') throw new Error('Room fixture required');
    assert({
      given: 'a seated nonhost',
      should: 'allow self readiness and leave but refuse management',
      actual: ['room.ready', 'room.leave', 'room.manage'].map(
        (capability) =>
          authorize({
            ...input,
            capability: capability as AuthorizationInput['capability'],
            resource: {
              ...resource,
              participants: [{ actorId: 'a', role: 'debater', slot: 0 }],
            },
          }).allow,
      ),
      expected: [true, true, false],
    });
  });
});
