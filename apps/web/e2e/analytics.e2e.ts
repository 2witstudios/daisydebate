import { captureAnalytics } from './support/analytics-capture';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { AnalyticsBrowser } from './support/analytics-browser-entry';
import { expect, test, openPage } from './support/fixtures';

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
  const { captures, requests } = await captureAnalytics(page.context());
  // This page hosts an isolated SDK fixture; the application's configured
  // CSP origins are covered separately by proxy-handler.test.ts.
  await page.context().route('**/analytics?**', async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response, headers });
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
  const pageEvents = () =>
    captures.filter((event) => event.event === 'page_viewed');
  await setup('granted', null);
  await expect.poll(() => pageEvents().length).toBe(1);
  const original = pageEvents()[0]?.properties.anonymousId;
  expect(original).toBeTruthy();
  await page.reload();
  await page.evaluate(bundle);
  await setup('granted', null);
  await expect.poll(() => pageEvents().length).toBe(2);
  expect(pageEvents()[1]?.properties.anonymousId).toBe(original);
  await setup('granted', 'u'.repeat(24));
  await expect.poll(() => pageEvents().length).toBe(3);
  expect(
    captures.find((event) => event.event === '$identify')?.properties
      .$anon_distinct_id,
  ).toBe(original);
  expect(pageEvents()[2]?.properties.userId).toBe('u'.repeat(24));
  await page.reload();
  await page.evaluate(bundle);
  await setup('granted', 'u'.repeat(24));
  await expect.poll(() => pageEvents().length).toBe(4);
  expect(pageEvents()[3]?.properties.userId).toBe('u'.repeat(24));
  await page.reload();
  await page.evaluate(bundle);
  await setup('granted', null);
  await expect.poll(() => pageEvents().length).toBe(5);
  expect(pageEvents()[4]?.properties.anonymousId).toBeTruthy();
  expect(pageEvents()[4]?.properties.distinct_id).not.toBe('u'.repeat(24));
  expect(pageEvents()[4]?.properties).not.toHaveProperty('userId');
  expect(JSON.stringify(captures)).not.toContain('private@example.test');
  for (const event of captures) {
    expect(event).not.toHaveProperty('$set');
    expect(event).not.toHaveProperty('$set_once');
    expect(event.properties.token).toBe('phc_browser_fixture');
  }
  const other = await openPage(page.context(), 'second analytics tab');
  await other.goto('/analytics?secret=private@example.test');
  await other.evaluate(bundle);
  await other.evaluate(() => {
    const sdk = (window as unknown as { daisyAnalyticsTest: AnalyticsBrowser })
      .daisyAnalyticsTest;
    const consent = {
      version: 1,
      necessary: 'granted',
      analytics: 'granted',
      replay: 'unanswered',
    } as const;
    sdk.syncAnalytics({
      key: 'phc_browser_fixture',
      host: 'https://us.i.posthog.com',
      consent,
      userId: null,
    });
    sdk.trackClient({ event: 'page_viewed', properties: { area: 'home' } });
    sdk.watchConsent({ consent, userId: null }, () => {
      sdk.stopAnalytics();
      document.body.dataset.analyticsRefreshed = 'yes';
    });
  });
  await expect.poll(() => pageEvents().length).toBe(6);
  await page.evaluate(() => {
    const sdk = (window as unknown as { daisyAnalyticsTest: AnalyticsBrowser })
      .daisyAnalyticsTest;
    sdk.watchConsent(
      {
        consent: {
          version: 1,
          necessary: 'granted',
          analytics: 'denied',
          replay: 'unanswered',
        },
        userId: null,
      },
      () => {},
    );
  });
  await expect(other.locator('body')).toHaveAttribute(
    'data-analytics-refreshed',
    'yes',
  );
  await other.evaluate(() => {
    (
      window as unknown as { daisyAnalyticsTest: AnalyticsBrowser }
    ).daisyAnalyticsTest.trackClient({ event: 'room_created', properties: {} });
  });
  await other.close();
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
