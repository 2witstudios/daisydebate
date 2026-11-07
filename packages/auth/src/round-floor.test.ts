import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideRoundFloor } from './round-floor';
setupRitewayBun();
const now = '2026-11-06T12:00:00.000Z';
const principal = { userId: 'user', actorId: 'actor' };
const account = {
  ...principal,
  member: true,
  erased: false,
  revision: 1,
  beta: { state: 'approved' as const, revision: 1 },
  ageBand: 'adult' as const,
  restricted: false,
};
const fact = {
  kind: 'round_floor' as const,
  roundId: 'round',
  channelId: null,
  policyKey: 'round.floor' as const,
  policyRevision: 1 as const,
  revision: 1,
  status: 'opening' as const,
  completedAt: null,
  actorId: 'actor',
  audience: 'debater' as const,
};
describe('decideRoundFloor', () => {
  test('current private audience', () => {
    assert({
      given: 'the current human debater or named host, or a judge or outsider',
      should: 'admit only the debater and named host',
      actual: ['debater', 'host', null].map(
        (audience) =>
          decideRoundFloor({
            principal,
            account,
            fact: { ...fact, audience: audience as 'debater' | 'host' | null },
            action: 'post',
            now,
          }).allow,
      ),
      expected: [true, true, false],
    });
  });
  test('retained original audience', () => {
    const completed = {
      ...fact,
      status: 'completed' as const,
      completedAt: '2026-11-06T12:00:00.000Z',
    };
    assert({
      given: 'a terminal Round before and at its retention deadline',
      should:
        'admit retained reading only before end plus 180 days and never posting',
      actual: [
        decideRoundFloor({
          principal,
          account,
          fact: completed,
          action: 'read',
          now,
        }).allow,
        decideRoundFloor({
          principal,
          account,
          fact: completed,
          action: 'post',
          now,
        }).allow,
        decideRoundFloor({
          principal,
          account,
          fact: completed,
          action: 'read',
          now: '2027-05-05T12:00:00.000Z',
        }).allow,
      ],
      expected: [true, false, false],
    });
  });
  test('current eligible account', () => {
    assert({
      given: 'a restricted, erased, foreign, or unadmitted account',
      should: 'refuse without inferring access from the seat',
      actual: [
        { restricted: true },
        { erased: true },
        { userId: 'foreign' },
        { beta: null },
        { ageBand: null },
      ].map(
        (change) =>
          decideRoundFloor({
            principal,
            account: { ...account, ...change },
            fact,
            action: 'read',
            now,
          }).allow,
      ),
      expected: [false, false, false, false, false],
    });
  });
});
