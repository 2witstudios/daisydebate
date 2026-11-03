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
      beta: { state: 'approved', revision: 1 },
      ageBand: 'adult',
      restricted: false,
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

test('persisted Round reads use their own canonical authority', () => {
  const resource = {
    kind: 'round' as const,
    roundId: 'round',
    createdByActorId: 'host',
    visibility: 'private' as const,
    status: 'opening',
    revision: 1,
    participants: [],
  };
  assert({
    given:
      'private Round, creator, seated, public non-participant and erased current accounts',
    should:
      'allow only seats and the host: public visibility grants no live read',
    actual: [
      authorize({ ...input, capability: 'round.read', resource }).allow,
      authorize({
        ...input,
        capability: 'round.read',
        resource: { ...resource, createdByActorId: 'a' },
      }).allow,
      authorize({
        ...input,
        capability: 'round.read',
        resource: {
          ...resource,
          participants: [{ actorId: 'a', role: 'debater', slot: 0 }],
        },
      }).allow,
      authorize({
        ...input,
        capability: 'round.read',
        resource: { ...resource, visibility: 'public' },
      }).allow,
      authorize({
        ...input,
        capability: 'round.read',
        resource: { ...resource, visibility: 'public' },
        context: { account: { ...input.context.account!, erased: true } },
      }).allow,
    ],
    expected: [false, true, true, false, false],
  });
});

test('live Round reads and the undelayed observer', () => {
  const round = {
    kind: 'round' as const,
    roundId: 'round',
    createdByActorId: 'host',
    visibility: 'public' as const,
    status: 'active',
    revision: 1,
    participants: [] as { actorId: string; role: string; slot: number }[],
  };
  const allow = (
    capability: 'round.read' | 'round.observe.undelayed',
    resource: typeof round,
  ) => authorize({ ...input, capability, resource }).allow;
  const asHost = { ...round, createdByActorId: 'a' };
  const seated = [{ actorId: 'a', role: 'affirmative', slot: 0 }];
  assert({
    given: 'a member with no seat on a public or an unlisted Round',
    should: 'grant no live read and no undelayed observation',
    actual: [
      allow('round.read', round),
      allow('round.read', { ...round, visibility: 'unlisted' as never }),
      allow('round.observe.undelayed', round),
    ],
    expected: [false, false, false],
  });
  assert({
    given: 'a seatless host, on a public and on a private Round',
    should: 'hold undelayed observation on every Round',
    actual: [
      allow('round.observe.undelayed', asHost),
      allow('round.observe.undelayed', {
        ...asHost,
        visibility: 'private' as never,
      }),
    ],
    expected: [true, true],
  });
  assert({
    given: 'a host who also holds a seat',
    should: 'read through the seat and gain no observer capability',
    actual: [
      allow('round.read', { ...asHost, participants: seated }),
      allow('round.observe.undelayed', { ...asHost, participants: seated }),
    ],
    expected: [true, false],
  });
});
