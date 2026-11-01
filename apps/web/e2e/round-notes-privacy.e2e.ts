import { signUpMember } from './support/accounts';
import { expect, test } from './support/fixtures';

/** Orphaned retained copies still contain private data and require identity fencing. */
test('retained private copies coalesce focus checks and cancel stale identity answers', async ({
  page,
}) => {
  await signUpMember(page.request);
  const response = await page.request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const { user } = await response.json();
  expect(user.id).toMatch(/^[a-z0-9]{24}$/);
  await page.goto('/settings');
  const retainedKey = `daisy:round-notes:draft:${user.id}:${'r'.repeat(24)}:${'d'.repeat(24)}`;
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          recovery: {
            html: '<p>Retained private copy</p>',
            baseRevision: 1,
            generation: 'retained',
            savedAt: 1,
            expiresAt: 604800001,
          },
        }),
      ),
    retainedKey,
  );
  const gate = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  let calls = 0;
  let cancelled = false;
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/get-session') {
      cancelled = true;
      aborted.resolve();
    }
  });
  await page.route('**/api/auth/get-session', async (route) => {
    calls += 1;
    const actual = await route.fetch();
    await Promise.race([gate.promise, aborted.promise]);
    if (!cancelled) await route.fulfill({ response: actual });
  });
  try {
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => calls).toBe(1);
    // A cross-tab marker only withdraws private data; it grants no identity.
    await page.evaluate(() =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'daisy:round-notes:principal',
          newValue: 'n'.repeat(24),
        }),
      ),
    );
    await expect.poll(() => cancelled).toBe(true);
    gate.resolve();
    await expect
      .poll(() =>
        page.evaluate((key) => localStorage.getItem(key), retainedKey),
      )
      .toBeNull();
    expect(
      await page.evaluate(() =>
        localStorage.getItem('daisy:round-notes:principal'),
      ),
    ).toBe('n'.repeat(24));
    expect(calls).toBe(1);
  } finally {
    gate.resolve();
    await page.unroute('**/api/auth/get-session');
  }
});
