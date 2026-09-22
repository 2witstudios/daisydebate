import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import {
  decideAccess,
  hasSessionCookie,
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

describe('hasSessionCookie', () => {
  test('recognizes only a Better Auth session cookie by exact name', () => {
    assert({
      given:
        'no header, unrelated cookies, lookalike names and both real names',
      should: 'answer true only when a session cookie is present',
      actual: [
        hasSessionCookie(null),
        hasSessionCookie('x=1; daisy-theme=dark'),
        hasSessionCookie('better-auth.session_token_fake=1'),
        hasSessionCookie('x=1; better-auth.session_token=abc.def'),
        hasSessionCookie('__Secure-better-auth.session_token=abc'),
      ],
      expected: [false, false, false, true, true],
    });
  });
});
