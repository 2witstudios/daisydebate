import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideRoundFloorPermit } from './round-floor-viewer';
setupRitewayBun();
const principal = { actorId: 'actor', userId: 'user', sessionId: 'session' };
const instant = '2026-11-07T00:00:00.000Z';
const account = {
  userId: 'user',
  actorId: 'actor',
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  restricted: false,
};
const session = {
  ...principal,
  account,
  expiresAt: '2026-11-08T00:00:00.000Z',
};
const fact = {
  kind: 'round_floor' as const,
  roundId: 'round',
  channelId: 'channel',
  policyKey: 'round.floor' as const,
  policyRevision: 1 as const,
  revision: 5,
  status: 'opening' as const,
  completedAt: null,
  actorId: 'actor',
  audience: 'debater' as const,
};
const input = {
  principal,
  session,
  fact,
  contentRevision: 8,
  started: 100,
  now: 100,
  instant,
};
describe('floor observation permits', () => {
  test('read-start bound and current content floor', () =>
    assert({
      given: 'an eligible current floor viewer and fenced content revision',
      should:
        'issue only a 4700ms permit with exact disclosure and content floor',
      actual: decideRoundFloorPermit(input),
      expected: {
        status: 'allowed',
        partition: 'members',
        disclosureRevision: 5,
        minimumContentRevision: 8,
        validUntil: 4800,
      },
    }));
  test('retention boundary', () =>
    assert({
      given: 'a terminal floor one second before end plus 180 days',
      should:
        'bound the permit at retention expiry even while the session continues',
      actual: decideRoundFloorPermit({
        ...input,
        fact: {
          ...fact,
          status: 'completed',
          completedAt: '2026-05-11T00:00:01.000Z',
        },
      }),
      expected: {
        status: 'allowed',
        partition: 'members',
        disclosureRevision: 5,
        minimumContentRevision: 8,
        validUntil: 1100,
      },
    }));
  test('no private floor grant', () =>
    assert({
      given: 'an outsider or revoked session',
      should: 'deny without a projection grant',
      actual: [
        decideRoundFloorPermit({ ...input, fact: { ...fact, audience: null } }),
        decideRoundFloorPermit({ ...input, session: null }),
      ],
      expected: [{ status: 'denied' }, { status: 'denied' }],
    }));
});
