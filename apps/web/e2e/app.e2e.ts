import { expect, test, type Page } from '@playwright/test';
import { signUpMember } from './support/accounts';

const publicTitles: Record<string, string> = {
  '/': 'Daisy',
  '/debates': 'Debates',
  '/watch': 'Watch',
  '/leaderboard': 'Leaderboard',
  '/tournaments': 'Tournaments',
  '/train': 'Train',
  '/prep': 'Prep',
};
// Participant areas (and Settings) need an account (AUTH-4.5).
const guardedTitles: Record<string, string> = {
  '/play': 'Play',
  '/ranked': 'Ranked',
  '/lobby': 'Lobby',
  '/judge': 'Judge',
  '/recordings': 'Recordings',
  '/settings': 'Settings',
};

const expectShell = async (page: Page, route: string, title: string) => {
  await page.goto(route);
  await expect(page).toHaveURL(new RegExp(`${route}$`));
  await expect(page).toHaveTitle(
    route === '/' ? new RegExp(`^${title}$`) : new RegExp(`^${title} · Daisy$`),
  );
  await expect(page.locator('main h1')).toHaveText(
    route === '/' ? 'Join the marketplace of ideas' : title,
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

test('dynamic profile route renders the requested username', async ({
  page,
}) => {
  await page.goto('/profile/debater-42');
  await expect(page.locator('main h1')).toHaveText('@debater-42');
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
