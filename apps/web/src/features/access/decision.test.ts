import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import {
  decideAccess,
  nextDestination,
  onboardingHref,
  passkeyOfferHref,
  requirementFor,
  signInHref,
  isGuardedPath,
  requestedPath,
  returnDestination,
} from './decision';

setupRitewayBun();

const anonymous: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};
const provisional: Identity = {
  state: 'provisional',
  principal: { kind: 'user', userId: 'u', permissions: [] },
};
const member: Identity = {
  state: 'member',
  username: 'ada',
  principal: { kind: 'user', userId: 'u', permissions: ['debate:create'] },
};

describe('decideAccess', () => {
  test('an anonymous visitor is sent to sign-in carrying the local path', () => {
    assert({
      given: 'an anonymous request for /lobby',
      should: 'redirect to /sign-in with next=/lobby',
      actual: decideAccess({
        identity: anonymous,
        path: '/lobby',
        requirement: 'participant',
      }),
      expected: { kind: 'redirect', to: '/sign-in?next=%2Flobby' },
    });
  });

  test('a provisional account is sent to onboarding before participant pages', () => {
    assert({
      given: 'a provisional account requesting /play',
      should: 'redirect to username onboarding carrying the path',
      actual: decideAccess({
        identity: provisional,
        path: '/play',
        requirement: 'participant',
      }),
      expected: { kind: 'redirect', to: '/onboarding/username?next=%2Fplay' },
    });
  });

  test('a provisional account may reach account pages', () => {
    assert({
      given: 'a provisional account requesting the account requirement',
      should: 'allow it',
      actual: decideAccess({
        identity: provisional,
        path: '/settings',
        requirement: 'account',
      }),
      expected: { kind: 'allow' },
    });
  });

  test('a member reaches participant pages', () => {
    assert({
      given: 'a member requesting a participant page',
      should: 'allow it',
      actual: decideAccess({
        identity: member,
        path: '/ranked',
        requirement: 'participant',
      }),
      expected: { kind: 'allow' },
    });
  });

  test('the carried path can never be an absolute or protocol-relative URL', () => {
    const to = (path: string) =>
      decideAccess({
        identity: anonymous,
        path,
        requirement: 'participant',
      });
    assert({
      given: 'hostile paths',
      should: 'fall back to the lobby destination',
      actual: [to('//evil.example/x'), to('https://evil.example/')],
      expected: [
        { kind: 'redirect', to: '/sign-in?next=%2Flobby' },
        { kind: 'redirect', to: '/sign-in?next=%2Flobby' },
      ],
    });
  });
});

describe('decideAccess during a session-store outage', () => {
  test('refuses as unavailable instead of sending a member to sign-in', () => {
    const unavailable: Identity = {
      state: 'unavailable',
      principal: { kind: 'anonymous' },
    };
    assert({
      given: 'an unreadable session store for participant and account pages',
      should: 'answer unavailable for both, never a sign-in redirect',
      actual: [
        decideAccess({
          identity: unavailable,
          path: '/lobby',
          requirement: 'participant',
        }),
        decideAccess({
          identity: unavailable,
          path: '/settings',
          requirement: 'account',
        }),
      ],
      expected: [{ kind: 'unavailable' }, { kind: 'unavailable' }],
    });
  });
});

describe('isGuardedPath', () => {
  test('the six participant areas and their descendants are guarded', () => {
    assert({
      given: 'guarded roots, a descendant, lookalikes and spectator routes',
      should: 'guard only the roots and their descendants',
      actual: [
        '/play',
        '/ranked',
        '/lobby',
        '/judge',
        '/recordings',
        '/settings',
        '/lobby/abc',
        '/settings/security',
        '/playground',
        '/lobbyist',
        '/watch',
        '/watch/abc',
        '/sign-in',
        '/',
      ].map(isGuardedPath),
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
    });
  });
});

describe('returnDestination: disguised forbidden routes', () => {
  test('dot segments and percent-encoding cannot reach sign-in, auth or api', () => {
    assert({
      given:
        'forbidden routes hidden by dot segments, encoding and double encoding',
      should: 'fall back to the lobby for every one',
      actual: [
        '/lobby/../api/auth/sign-out',
        '/%73ign-in',
        '/%2573ign-in',
        '/lobby/%2E%2E/auth/confirm',
        '/%61pi/auth/get-session',
        '/./sign-in?next=/lobby',
      ].map(returnDestination),
      expected: Array(6).fill('/lobby'),
    });
  });

  test('ordinary destinations keep their path and query', () => {
    assert({
      given: 'local pages whose names merely start like forbidden routes',
      should: 'keep them as given',
      actual: [
        '/sign-ins',
        '/apiary',
        '/lobby/../ranked',
        '/ranked?tab=%61',
      ].map(returnDestination),
      expected: ['/sign-ins', '/apiary', '/lobby/../ranked', '/ranked?tab=%61'],
    });
  });
});

describe('returnDestination', () => {
  test('keeps a local path and refuses loops and foreign targets', () => {
    assert({
      given: 'a local path, sign-in and API routes, and foreign URLs',
      should: 'keep only the local product path',
      actual: [
        '/ranked?tab=open',
        '/sign-in?next=/lobby',
        '/api/auth/get-session',
        '/auth/confirm',
        'https://evil.example',
        '//evil.example',
        null,
      ].map(returnDestination),
      expected: [
        '/ranked?tab=open',
        '/lobby',
        '/lobby',
        '/lobby',
        '/lobby',
        '/lobby',
        '/lobby',
      ],
    });
  });
});

describe('requestedPath', () => {
  test('keeps the page query, repeated keys included', () => {
    assert({
      given: 'no query, one value, repeated values and an empty entry',
      should: 'rebuild the local path with its query',
      actual: [
        requestedPath('/lobby', {}),
        requestedPath('/lobby', { tab: 'open' }),
        requestedPath('/ranked', { f: ['a', 'b'], skip: undefined }),
      ],
      expected: ['/lobby', '/lobby?tab=open', '/ranked?f=a&f=b'],
    });
  });

  test('the rebuilt path survives the sign-in redirect', () => {
    assert({
      given: 'an anonymous request for /lobby?tab=open',
      should: 'carry the query in next',
      actual: decideAccess({
        identity: { state: 'anonymous', principal: { kind: 'anonymous' } },
        path: requestedPath('/lobby', { tab: 'open' }),
        requirement: 'participant',
      }),
      expected: { kind: 'redirect', to: '/sign-in?next=%2Flobby%3Ftab%3Dopen' },
    });
  });
});

describe('requirementFor', () => {
  test('each guarded area has one requirement, inherited by descendants', () => {
    assert({
      given: 'guarded roots, descendants, lookalikes and public routes',
      should: 'answer participant, account or null',
      actual: [
        '/play',
        '/lobby/abc',
        '/settings/security',
        '/lobbyist',
        '/watch',
        '/',
      ].map(requirementFor),
      expected: ['participant', 'participant', 'account', null, null, null],
    });
  });
});

describe('return links', () => {
  test('read next from the query and build sign-in and onboarding links', () => {
    assert({
      given: 'a query next, a repeated next, a hostile next and a destination',
      should: 'validate next and encode the destination as one value',
      actual: [
        nextDestination({ next: '/ranked?tab=a' }),
        nextDestination({ next: ['/judge', '/play'] }),
        nextDestination({ next: '//evil.example' }),
        signInHref('/lobby?tab=a&b=1'),
        onboardingHref('/ranked'),
        signInHref(onboardingHref('/ranked')),
        passkeyOfferHref('/lobby?tab=a'),
      ],
      expected: [
        '/ranked?tab=a',
        '/judge',
        '/lobby',
        '/sign-in?next=%2Flobby%3Ftab%3Da%26b%3D1',
        '/onboarding/username?next=%2Franked',
        '/sign-in?next=%2Fonboarding%2Fusername%3Fnext%3D%252Franked',
        '/onboarding/passkey?next=%2Flobby%3Ftab%3Da',
      ],
    });
  });
});
