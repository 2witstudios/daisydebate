import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { decideAccess, requirementFor, restrictedHref } from './decision';

setupRitewayBun();

const waitlisted: Identity = {
  state: 'waitlisted',
  username: 'ada',
  reason: 'pending',
  principal: { kind: 'user', userId: 'u', actorId: 'actor1' },
};

describe('decideAccess for a restricted account (ADR 0103)', () => {
  test('a restricted account goes straight to its own page and keeps its account pages', () => {
    const restricted: Identity = {
      state: 'restricted',
      username: 'ada',
      principal: waitlisted.principal,
    };
    assert({
      given: 'a restricted account requesting /play and /settings',
      should:
        'send /play to /restricted, not the beta page, and allow /settings',
      actual: [
        decideAccess({
          identity: restricted,
          path: '/play?x=1',
          requirement: 'participant',
        }),
        decideAccess({
          identity: restricted,
          path: '/settings',
          requirement: 'account',
        }),
      ],
      expected: [{ kind: 'redirect', to: '/restricted' }, { kind: 'allow' }],
    });
  });
});

describe('restrictedHref (ADR 0103)', () => {
  test('a failed sign-out keeps its notice on the way to the restricted page', () => {
    assert({
      given: 'a page query with and without a failed sign-out',
      should: 'carry only that flag over',
      actual: [
        restrictedHref({ signOut: 'failed', next: '/play' }),
        restrictedHref({ next: '/play' }),
      ],
      expected: ['/restricted?signOut=failed', '/restricted'],
    });
  });
});

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

  test('a fresh sign-up finishes onboarding unapproved and waits with its destination', () => {
    assert({
      given:
        'a pending account finishing onboarding toward /ranked, then going there',
      should:
        'leave the onboarding steps ungated and send /ranked to /beta carrying it',
      actual: [
        requirementFor('/onboarding/daisy'),
        requirementFor('/onboarding/ready'),
        requirementFor('/beta'),
        decideAccess({
          identity: waitlisted,
          path: '/ranked',
          requirement: 'participant',
        }),
      ],
      expected: [
        null,
        null,
        null,
        { kind: 'redirect', to: '/beta?next=%2Franked' },
      ],
    });
  });
});
