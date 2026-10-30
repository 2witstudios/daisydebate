import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createTestApp, cookieHeader, type TestApp } from './fixtures';
import { createFlows } from './auth-mounted-flows';
import { cookieConsent } from '../src/features/analytics/handlers';

setupRitewayBun();
requireTestServices(process.env);
const configured = () =>
  createTestApp({
    NEXT_PUBLIC_POSTHOG_KEY: 'phc_fixture',
    NEXT_PUBLIC_POSTHOG_HOST: 'https://eu.i.posthog.com',
    POSTHOG_PERSONAL_API_KEY: 'phx_fixture',
    POSTHOG_PROJECT_ID: '1',
  });

const post = (
  fixture: TestApp,
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
  const fixture = configured();
  const accepted = await fixture.routes.analyticsConsent.POST(
    post(fixture, { choice: 'accept' }),
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
    post(fixture, { choice: 'deny' }, { cookie: cookieHeader(accepted) }),
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
    post(fixture, { choice: 'accept' }, { origin: 'https://attacker.invalid' }),
  );
  assert({
    given: 'a cross-site attempt to grant consent',
    should: 'refuse without changing cookies',
    actual: [crossSite.status, crossSite.headers.getSetCookie()],
    expected: [403, []],
  });
});

test('anonymous consent adoption on sign-in is durable and never overrides refusal', async () => {
  const fixture = configured();
  const flows = createFlows(fixture);
  const anonymous = await fixture.routes.analyticsConsent.POST(
    post(fixture, { choice: 'accept' }),
  );
  const signup = await flows.startSignup();
  const signedIn = await flows.redeem(signup.token);
  const session = await fixture.app.auth().instance.api.getSession({
    headers: new Headers({ cookie: cookieHeader(signedIn) }),
  });
  if (!session)
    throw new Error('The consent proof requires its own signed-in account');
  const cookie = `${cookieHeader(signedIn)}; ${cookieHeader(anonymous)}`;
  const adopted = await fixture.routes.analyticsConsent.POST(
    post(fixture, { choice: 'adopt' }, { cookie }),
  );
  assert({
    given: 'a real sign-in after anonymous browser opt-in',
    should: 'adopt consent for the authenticated account before capture',
    actual: [
      adopted.status,
      (await fixture.app.database.readAnalyticsConsent(session.user.id))
        ?.analytics,
    ],
    expected: [204, 'granted'],
  });
  await fixture.routes.analyticsConsent.POST(
    post(fixture, { choice: 'deny' }, { cookie }),
  );
  await fixture.routes.analyticsConsent.POST(
    post(fixture, { choice: 'adopt' }, { cookie }),
  );
  assert({
    given: 'a stale browser opt-in after account withdrawal',
    should: 'preserve the durable refusal',
    actual: (await fixture.app.database.readAnalyticsConsent(session.user.id))
      ?.analytics,
    expected: 'denied',
  });
});
