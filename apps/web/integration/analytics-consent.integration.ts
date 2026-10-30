import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestApp, cookieHeader } from './fixtures';
import { cookieConsent } from '../src/features/analytics/handlers';

setupRitewayBun();
const fixture = createTestApp({
  NEXT_PUBLIC_POSTHOG_KEY: 'phc_fixture',
  NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
  POSTHOG_PERSONAL_API_KEY: 'phx_fixture',
  POSTHOG_PROJECT_ID: '1',
});

const post = (
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  new Request(`${fixture.origin}/api/analytics/consent`, {
    method: 'POST',
    headers: {
      origin: fixture.origin,
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(fields),
  });

test('native consent POST records only offered choices and supports withdrawal', async () => {
  const accepted = await fixture.routes.analyticsConsent.POST(
    post({ choice: 'accept' }),
  );
  assert({
    given: 'an anonymous native form acceptance',
    should: 'redirect without JavaScript and store only the offered category',
    actual: [
      accepted.status,
      accepted.headers.get('location'),
      cookieConsent(cookieHeader(accepted)),
    ],
    expected: [
      303,
      '/analytics?saved=1',
      {
        version: 1,
        necessary: 'granted',
        analytics: 'granted',
        replay: 'unanswered',
      },
    ],
  });
  const denied = await fixture.routes.analyticsConsent.POST(
    post({ choice: 'deny' }, { cookie: cookieHeader(accepted) }),
  );
  assert({
    given: 'a later native form refusal',
    should: 'withdraw analytics without changing hidden replay consent',
    actual: cookieConsent(cookieHeader(denied)),
    expected: {
      version: 1,
      necessary: 'granted',
      analytics: 'denied',
      replay: 'unanswered',
    },
  });
  const crossSite = await fixture.routes.analyticsConsent.POST(
    post({ choice: 'accept' }, { origin: 'https://attacker.invalid' }),
  );
  assert({
    given: 'a cross-site attempt to grant consent',
    should: 'refuse without changing cookies',
    actual: [crossSite.status, crossSite.headers.getSetCookie()],
    expected: [403, []],
  });
});
