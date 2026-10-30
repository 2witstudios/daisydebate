import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createServerAnalytics } from './server-adapter';
import { unansweredConsent } from './consent';

setupRitewayBun();
test('the actual server SDK is gated before transport and sends only registered properties', async () => {
  const sent: unknown[] = [];
  const sender = createServerAnalytics({
    key: 'phc_fixture',
    host: 'https://us.i.posthog.com',
    fetch: async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ status: 1 });
    },
  });
  const message = {
    userId: 'u'.repeat(24),
    consent: unansweredConsent,
    productEvent: { event: 'room_created', properties: {} },
  } as const;
  for (const analytics of ['unanswered', 'denied'] as const)
    await sender.track({
      ...message,
      consent: { ...unansweredConsent, analytics },
    });
  await sender.track({
    ...message,
    userId: 'invalid',
    consent: { ...unansweredConsent, analytics: 'granted' },
  });
  assert({
    given: 'unanswered/denied consent or an invalid principal',
    should: 'perform no vendor request',
    actual: sent,
    expected: [],
  });
  await sender.track({
    ...message,
    consent: { ...unansweredConsent, analytics: 'granted' },
  });
  assert({
    given: 'a consented registered server fact',
    should: 'deliver through the real SDK once without private enrichment',
    actual: [
      sent.length,
      JSON.stringify(sent).includes('room_created'),
      JSON.stringify(sent).includes('email'),
    ],
    expected: [1, true, false],
  });
  await sender.close();
});

test('missing server configuration stays inert', async () => {
  const sent: string[] = [];
  for (const config of [
    { key: null, host: 'https://us.i.posthog.com' },
    { key: 'phc_fixture', host: null },
  ]) {
    const sender = createServerAnalytics({
      ...config,
      fetch: async (url) => {
        sent.push(String(url));
        return Response.json({ status: 1 });
      },
    });
    await sender.track({
      userId: 'u'.repeat(24),
      consent: { ...unansweredConsent, analytics: 'granted' },
      productEvent: { event: 'room_created', properties: {} },
    });
    await sender.close();
  }
  assert({
    given: 'a missing key or host',
    should: 'initialize no transport',
    actual: sent,
    expected: [],
  });
});
