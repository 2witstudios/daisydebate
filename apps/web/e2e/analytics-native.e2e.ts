import { expect, test, openPage } from './support/fixtures';
import {
  captureAnalytics,
  expectAnalyticsPrivacy,
} from './support/analytics-capture';
import { signUpMember } from './support/accounts';

test('native opt-in survives reload and sign-in; Settings withdrawal stops every tab', async ({
  page,
  context,
}) => {
  const { captures, requests } = await captureAnalytics(context);
  await page.goto('/?secret=private@example.test');
  await expect(
    page.getByRole('button', { name: 'Accept optional' }),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Accept optional' }).click();
  await expect(page).toHaveURL(/\/analytics\?saved=1$/);
  await page.goto('/');
  const home = () =>
    captures.filter(
      (event) =>
        event.event === 'page_viewed' && event.properties.area === 'home',
    );
  await expect.poll(() => home().length).toBe(1);
  const anonymous = home()[0]?.properties.anonymousId;
  await page.reload();
  await expect.poll(() => home().length).toBe(2);
  expect(home()[1]?.properties.anonymousId).toBe(anonymous);
  await signUpMember(page.request);
  const adopted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/analytics/consent') &&
      response.request().postData() === 'choice=adopt' &&
      response.status() === 204,
  );
  await page.goto('/settings');
  await adopted;
  await expect(page.getByLabel('Product analytics')).toBeChecked();
  await expect
    .poll(() => captures.filter((event) => event.event === '$identify').length)
    .toBe(1);
  expect(
    captures.find((event) => event.event === '$identify')?.properties
      .$anon_distinct_id,
  ).toBe(anonymous);
  await expect(page.getByLabel('Masked session replay')).not.toBeVisible();
  const other = await openPage(context, 'analytics preferences');
  await other.goto('/settings');
  await expect(other.getByLabel('Product analytics')).toBeChecked();
  await expect
    .poll(
      () =>
        captures.filter(
          (event) =>
            event.event === 'page_viewed' &&
            event.properties.area === 'settings',
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
  await page.getByLabel('Product analytics').uncheck();
  await page.getByRole('button', { name: 'Save choices' }).click();
  await expect(page).toHaveURL(/\/analytics\?saved=1$/);
  await expect(page.getByLabel('Product analytics')).not.toBeChecked();
  await expect(other.getByLabel('Product analytics')).not.toBeChecked();
  const before = captures.length;
  await other.goto('/');
  await page.reload();
  expect(captures).toHaveLength(before);
  expect(
    (await context.cookies()).filter(
      (cookie) => cookie.name === 'ph_daisy_analytics',
    ),
  ).toEqual([]);
  expectAnalyticsPrivacy(captures);
  await other.close();
});

test('consent acceptance and withdrawal work with JavaScript disabled', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    javaScriptEnabled: false,
    ignoreHTTPSErrors: true,
  });
  const { requests } = await captureAnalytics(context);
  try {
    const page = await openPage(context, 'analytics preferences');
    await page.goto('/');
    await page.getByRole('button', { name: 'Accept optional' }).click();
    await expect(page).toHaveURL(/\/analytics\?saved=1$/);
    await expect(page.getByLabel('Product analytics')).toBeChecked();
    await page.getByRole('button', { name: 'Reject optional' }).click();
    await expect(page.getByLabel('Product analytics')).not.toBeChecked();
    expect(requests).toEqual([]);
  } finally {
    await context.close();
  }
});

test('the stage Egress records carries no consent banner and no analytics (ADR 0123)', async ({
  page,
  context,
}) => {
  const { requests } = await captureAnalytics(context);
  const banner = page.getByRole('complementary', {
    name: 'Analytics preferences',
  });
  await page.goto('/');
  await expect(banner).toBeVisible();
  await page.goto('/stage/e2e-no-capture?c=absent');
  await expect(page.locator('main')).toBeAttached();
  await expect(banner).toHaveCount(0);
  await page.goto('/');
  await page.getByRole('button', { name: 'Accept optional' }).click();
  await expect(page).toHaveURL(/\/analytics\?saved=1$/);
  const before = requests.length;
  // The stage polls its own read each second: three answers mean the page
  // has run for seconds, long enough for any analytics client to have sent.
  const stageRead = () =>
    page.waitForResponse((response) =>
      response.url().includes('/api/stage/e2e-no-capture'),
    );
  const first = stageRead();
  await page.goto('/stage/e2e-no-capture?c=absent');
  await first;
  await stageRead();
  await stageRead();
  await expect(banner).toHaveCount(0);
  expect(requests.length).toBe(before);
});
