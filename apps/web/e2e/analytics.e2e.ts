import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AnalyticsBrowser } from './support/analytics-browser-entry';
import { expect, test } from './support/fixtures';

const entry = fileURLToPath(
  new URL('./support/analytics-browser-entry.ts', import.meta.url),
);
const bundle = execFileSync(
  'bun',
  [
    '-e',
    `const r=await Bun.build({entrypoints:[${JSON.stringify(entry)}],target:'browser',format:'iife'});if(!r.success)throw new Error('analytics fixture build failed');process.stdout.write(await r.outputs[0].text())`,
  ],
  { encoding: 'utf8', maxBuffer: 5_000_000 },
);

test('the real browser SDK is opt-in, scrubbed and resets on sign-out', async ({
  page,
}) => {
  const captures: { event: string; properties: Record<string, unknown> }[] = [];
  const requests: string[] = [];
  // This page hosts an isolated SDK fixture; the application's configured
  // CSP origins are covered separately by proxy-handler.test.ts.
  await page.route('**/analytics?**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
  });
  await page.route('https://*.posthog.com/**', async (route) => {
    const request = route.request();
    requests.push(request.url());
    const raw = request.postData();
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const events = Array.isArray(parsed)
        ? parsed
        : ((parsed as { batch?: unknown[] }).batch ?? [parsed]);
      captures.push(...(events as typeof captures));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    });
  });
  await page.goto('/analytics?secret=private@example.test');
  await page.evaluate(bundle);
  const setup = async (
    choice: 'granted' | 'denied' | 'unanswered',
    userId: string | null,
  ) =>
    page.evaluate(
      ({ choice, userId }) => {
        const sdk = (
          window as unknown as Window & { daisyAnalyticsTest: AnalyticsBrowser }
        ).daisyAnalyticsTest;
        sdk.syncAnalytics({
          key: 'phc_browser_fixture',
          host: 'https://us.i.posthog.com',
          consent: {
            version: 1,
            necessary: 'granted',
            analytics: choice,
            replay: 'unanswered',
          },
          userId,
        });
        sdk.trackClient({ event: 'page_viewed', properties: { area: 'home' } });
      },
      { choice, userId },
    );
  await setup('unanswered', null);
  expect(requests).toEqual([]);
  await setup('granted', 'u'.repeat(24));
  await expect
    .poll(
      () => captures.filter((event) => event.event === 'page_viewed').length,
    )
    .toBe(1);
  expect(JSON.stringify(captures)).not.toContain('private@example.test');
  expect(
    captures.find((event) => event.event === 'page_viewed')?.properties.userId,
  ).toBe('u'.repeat(24));
  await setup('granted', null);
  await expect
    .poll(
      () => captures.filter((event) => event.event === 'page_viewed').length,
    )
    .toBe(2);
  const anonymous = captures
    .filter((event) => event.event === 'page_viewed')
    .at(-1)?.properties;
  expect(anonymous?.anonymousId).toBeTruthy();
  expect(anonymous?.distinct_id).not.toBe('u'.repeat(24));
  expect(anonymous).not.toHaveProperty('userId');
  await setup('denied', null);
  await page.evaluate(() => {
    (
      window as unknown as Window & { daisyAnalyticsTest: AnalyticsBrowser }
    ).daisyAnalyticsTest.trackClient({ event: 'room_created', properties: {} });
  });
  expect(captures.filter((event) => event.event === 'room_created')).toEqual(
    [],
  );
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith('ph_'),
    ),
  ).toEqual([]);
});
