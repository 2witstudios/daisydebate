import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { decideAccess } from './decision';

setupRitewayBun();

const waitlisted: Identity = {
  state: 'waitlisted',
  username: 'ada',
  reason: 'pending',
  principal: { kind: 'user', userId: 'u', actorId: 'actor1' },
};

describe('decideAccess for the beta gate (ADR 0075)', () => {
  test('a waitlisted account waits on /beta for participant pages but keeps its account pages (ADR 0075)', () => {
    assert({
      given: 'a pending account requesting /play and /settings',
      should:
        'send /play to the beta page carrying the path, and allow /settings',
      actual: [
        decideAccess({
          identity: waitlisted,
          path: '/play?x=1',
          requirement: 'participant',
        }),
        decideAccess({
          identity: waitlisted,
          path: '/settings',
          requirement: 'account',
        }),
      ],
      expected: [
        { kind: 'redirect', to: '/beta?next=%2Fplay%3Fx%3D1' },
        { kind: 'allow' },
      ],
    });
  });
});
