import { assert, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import { createTestApp, cookieHeader } from './fixtures';
import { createFlows } from './auth-mounted-flows';
import { trackRequest } from '../src/features/analytics/track-request';
import {
  CONSENT_COOKIE,
  unansweredConsent,
} from '../src/features/analytics/consent';

setupRitewayBun();
test('server capture requires both request and durable consent and never waits for the vendor', async () => {
  const sent: unknown[] = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = createTestApp(
    {
      NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
      POSTHOG_API_KEY: 'phc_fixture',
      POSTHOG_PERSONAL_API_KEY: 'phx_fixture',
      POSTHOG_PROJECT_ID: '1',
    },
    undefined,
    systemClock,
    (downstream) => async (input, init) => {
      if (!String(input).startsWith('https://us.i.posthog.com/'))
        return downstream(input, init);
      sent.push(JSON.parse(String(init?.body)));
      await held;
      return Response.json({ status: 1 });
    },
  );
  const flows = createFlows(fixture);
  const signup = await flows.startSignup();
  const signed = await flows.redeem(signup.token);
  const session = await fixture.app
    .auth()
    .instance.api.getSession({
      headers: new Headers({ cookie: cookieHeader(signed) }),
    });
  if (!session)
    throw new Error('The capture proof requires its own signed-in account');
  const consent = { ...unansweredConsent, analytics: 'granted' } as const;
  const request = (analytics: 'granted' | 'denied' | 'unanswered') =>
    new Request(`${fixture.origin}/api/rooms`, {
      headers: {
        cookie: `${cookieHeader(signed)}; ${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ ...consent, analytics }))}`,
      },
    });
  const event = { event: 'room_created', properties: {} } as const;
  for (const analytics of ['denied', 'unanswered'] as const) {
    await fixture.app.database.saveAnalyticsConsent({
      userId: session.user.id,
      consent: { ...consent, analytics },
      now: systemClock.now(),
    });
    await trackRequest(fixture.app, request('granted'), event);
  }
  await fixture.app.database.saveAnalyticsConsent({
    userId: session.user.id,
    consent,
    now: systemClock.now(),
  });
  for (const analytics of ['denied', 'unanswered'] as const)
    await trackRequest(fixture.app, request(analytics), event);
  await fixture.app.analyticsDelivery.settled();
  assert({
    given: 'either the request or account denies/unanswers analytics',
    should: 'send no vendor request',
    actual: sent,
    expected: [],
  });
  // If delivery is awaited, this call cannot return: the injected transport
  // waits on the release below. No timing or sleep assertion is involved.
  await trackRequest(fixture.app, request('granted'), event);
  release();
  await fixture.app.analyticsDelivery.settled();
  assert({
    given: 'both consent gates grant and the vendor was held open',
    should:
      'return before vendor completion, then deliver the registered fact once',
    actual: [
      sent.length,
      JSON.stringify(sent).includes('room_created'),
      JSON.stringify(sent).includes(session.user.id),
    ],
    expected: [1, true, true],
  });
});
