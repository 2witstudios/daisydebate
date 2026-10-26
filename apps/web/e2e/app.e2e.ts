import { type Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { signUpMember } from './support/accounts';

const publicTitles: Record<string, string> = {
  '/': 'Daisy Debate',
  '/watch': 'Watch',
  '/leaderboard': 'Leaderboard',
  '/tournaments': 'Tournaments',
};
// Participant areas (and Settings) need an account (AUTH-4.5, ISSUE-167: /prep and /train too).
const guardedTitles: Record<string, string> = {
  '/play': 'Play',
  '/ranked': 'Ranked',
  '/lobby': 'Lobby',
  '/judge': 'Judge',
  '/recordings': 'Recordings',
  '/settings': 'Settings',
  '/prep': 'Prep',
  '/train': 'Train',
};

// Pages whose heading is not their metadata title: Recordings is a section of
// the Watch hub, so its page heading is "Watch".
const headings: Record<string, string> = { '/recordings': 'Watch' };

const expectShell = async (page: Page, route: string, title: string) => {
  await page.goto(route);
  await expect(page).toHaveURL(new RegExp(`${route}$`));
  await expect(page).toHaveTitle(
    route === '/'
      ? new RegExp(`^${title}$`)
      : new RegExp(`^${title} · Daisy Debate$`),
  );
  await expect(page.locator('main h1')).toHaveText(
    route === '/'
      ? 'Better arguments. A more thoughtful world.'
      : (headings[route] ?? title),
  );
};

test('public route shells render with their metadata titles', async ({
  page,
}) => {
  for (const [route, title] of Object.entries(publicTitles))
    await expectShell(page, route, title);
});

test('guarded areas send visitors to sign-in and render for a member', async ({
  page,
  request,
}) => {
  for (const route of Object.keys(guardedTitles)) {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()['location'] ?? '').pathname).toBe(
      '/sign-in',
    );
    expect(
      new URL(response.headers()['location'] ?? '').searchParams.get('next'),
    ).toBe(route);
  }
  await signUpMember(page.request);
  for (const [route, title] of Object.entries(guardedTitles))
    await expectShell(page, route, title);
});

test('a profile shows the real member, their record and history', async ({
  page,
}) => {
  const missing = await page.goto('/profile/nobody-holds-this-name');
  expect(missing?.status()).toBe(404);
  const { username } = await signUpMember(page.request);
  await page.goto(`/profile/${username.toUpperCase()}`);
  await expect(page.locator('main h1')).toHaveText(`@${username}`);
  await expect(page.getByText(/^Member since /)).toBeVisible();
  const record = page.getByRole('region', { name: 'Record' });
  await expect(record.getByText('Wins')).toBeVisible();
  await expect(record.getByText('Losses')).toBeVisible();
  await expect(
    page.getByText('You have no completed rounds yet.'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Edit profile' }),
  ).toHaveAttribute('href', '/settings');
  await expect(page.locator('main').getByText(/\b(rating|elo)\b/i)).toHaveCount(
    0,
  );
  // A link followed from another site renders the profile, not an error.
  const followed = await page.request.get(`/profile/${username}`, {
    headers: {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
    },
    maxRedirects: 0,
  });
  expect(followed.status()).toBe(200);
  const stale = await page.goto(
    `/profile/${username}?before=${'z'.repeat(24)}`,
  );
  expect(stale?.status()).toBe(404);
});

test('production security and correlation headers are present', async ({
  request,
}) => {
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const headers = response.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain(
    'upgrade-insecure-requests',
  );
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-request-id']).toMatch(/^[a-z0-9]{24}$/);
});

test('nonce CSP covers the scripts of every served route', async ({
  request,
}) => {
  // Single request: the nonce is per-request, so the raw body and the CSP
  // header must come from the same response. Assert against the raw HTML —
  // the hydrated DOM rewrites consumed script tags.
  const response = await request.get('/');
  expect(response.ok()).toBe(true);
  const policy = response.headers()['content-security-policy'] ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  if (!nonce) throw new Error('CSP policy carries no nonce');
  const html = await response.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
});

test('liveness and readiness report process and dependency state', async ({
  request,
}) => {
  const live = await request.get('/api/health/live');
  expect(live.status()).toBe(200);
  const ready = await request.get('/api/health/ready');
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toEqual({ status: 'ready' });
});

test('unknown routes serve the not-found boundary', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.locator('main h1')).toHaveText('Not found');
});

test('the development-only foundation proof stays closed in production', async ({
  page,
}) => {
  const response = await page.goto('/foundation');
  expect(response?.status()).toBe(404);
});
