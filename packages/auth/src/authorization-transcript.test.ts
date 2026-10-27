import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
setupRitewayBun();
const request = {
  principal: { kind: 'user', userId: 'u', actorId: 'reader' },
  capability: 'round.transcript.read',
  context: {
    account: {
      userId: 'u',
      actorId: 'reader',
      member: true,
      erased: false,
      revision: 1,
      beta: { state: 'approved', revision: 1 },
      ageBand: 'adult',
    },
  },
  resource: {
    kind: 'round',
    roundId: 'round',
    createdByActorId: 'host',
    visibility: 'public',
    status: 'active',
    revision: 1,
    participants: [],
  },
} as const;
test('transcript audience is private and independent of general Round visibility', () => {
  assert({
    given: 'a public viewer, seatless host, debater and judge',
    should: 'admit only the current transcript audience',
    actual: [
      request.resource,
      { ...request.resource, createdByActorId: 'reader' },
      ...['affirmative', 'negative', 'judge'].map((role) => ({
        ...request.resource,
        participants: [{ actorId: 'reader', role, slot: 0 }],
      })),
    ].map(
      (resource) =>
        authorize({ ...request, resource } as AuthorizationInput).allow,
    ),
    expected: [false, false, true, true, true],
  });
});
test('fresh account admission dominates a historical seat', () => {
  const resource = {
    ...request.resource,
    participants: [{ actorId: 'reader', role: 'judge', slot: 0 }],
  };
  assert({
    given: 'revoked, erased, underage and mismatched seated accounts',
    should: 'refuse every private transcript read',
    actual: [
      { ...request.context.account, beta: { state: 'revoked', revision: 2 } },
      { ...request.context.account, erased: true },
      { ...request.context.account, ageBand: '13-15' },
      { ...request.context.account, actorId: 'another' },
    ].map(
      (account) =>
        authorize({
          ...request,
          resource,
          context: { account },
        } as AuthorizationInput).allow,
    ),
    expected: [false, false, false, false],
  });
});
