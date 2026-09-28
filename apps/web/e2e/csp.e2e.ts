import { expect, test } from '@playwright/test';
import { resetRateLimits } from './support/accounts';
import { reachSentState, requestConfirmLink } from './support/confirm-page';
import { watchCspViolations } from './support/csp';

// A fixed-shape token: real redemption is never exercised here, only that
// the view renders with a style nonce.
const token = 'e2eTokenNotARealCredential0123456789';

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('the confirm page style nonce equals the response CSP header nonce (AUTH-4.7)', async ({
  request,
}) => {
  const response = await request.get(`/auth/confirm?token=${token}`);
  const policy = response.headers()['content-security-policy'] ?? '';
  const headerNonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  const html = await response.text();
  const styleNonce = /<style nonce="([^"]+)">/.exec(html)?.[1];
  expect(headerNonce).toBeTruthy();
  expect(styleNonce).toBe(headerNonce);
});

test('the dashboard renders under the production CSP without violations', async ({
  page,
}) => {
  const violations = await watchCspViolations(page);

  await page.goto('/');
  const hero = page.getByRole('img', {
    name: 'A green mountain ridge at dawn with rolling fog',
  });
  await expect(hero).toBeVisible();

  // `next/image` with `fill` sizes itself through an inline style attribute;
  // if the policy refuses it the image drops out of its absolute geometry.
  const geometry = await hero.evaluate((image) => {
    const parent = image.parentElement;
    if (!parent) throw new Error('hero image has no parent');
    const box = image.getBoundingClientRect();
    // An absolute fill covers the parent's padding box (inside its border).
    return {
      position: getComputedStyle(image).position,
      widthDelta: Math.abs(box.width - parent.clientWidth),
      heightDelta: Math.abs(box.height - parent.clientHeight),
      area: box.width * box.height,
    };
  });

  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
  expect(geometry.position).toBe('absolute');
  expect(geometry.area).toBeGreaterThan(0);
  expect(geometry.widthDelta).toBeLessThanOrEqual(1);
  expect(geometry.heightDelta).toBeLessThanOrEqual(1);
});

test('AUTH-4.7: every confirm-page state renders under the production CSP without violations', async ({
  page,
  request,
}) => {
  const violations = await watchCspViolations(page);

  // confirm
  const { link } = await requestConfirmLink(page, request);
  await page.goto(link);
  await expect(
    page.getByRole('button', { name: 'Sign in to Daisy' }),
  ).toBeVisible();

  // expired, then sent (a separate link, spent then resent)
  await reachSentState(page, request);

  // email-change confirm page
  await page.goto(`/auth/confirm-email?token=${'a'.repeat(43)}`);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

  expect(await violations.read()).toEqual({
    eventViolations: [],
    consoleViolations: [],
  });
});
