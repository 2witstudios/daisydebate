import { expect, test } from './support/fixtures';
import { origin, signUpMember } from './support/accounts';

test.describe('native Billing with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('a member reads current usage and return claims cannot grant Premium', async ({
    page,
  }) => {
    await signUpMember(page.request);
    await page.goto('/settings');
    await page.getByRole('link', { name: 'Billing', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Billing', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Free account', exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/debates remaining/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Get Premium/ })).toHaveCount(
      0,
    );

    await page.goto(
      '/settings/billing?purchase=cs_test_forged&success=true&plan=premium',
    );
    await expect(page.getByRole('status')).toContainText(
      'Your purchase is being checked',
    );
    await expect(
      page.getByRole('heading', { name: 'Free account', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Manage billing/ }),
    ).toHaveCount(0);
    const current = await page.request.get('/api/billing/settings');
    expect(current.status()).toBe(200);
    expect(current.headers()['cache-control']).toBe('no-store');
    const view = await current.json();
    expect(view.plan).toBe('free');
    expect(view.accessEndsAt).toBeNull();
    expect(view.checkoutAvailable).toBe(false);
    expect(view.manageAvailable).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(
      /userId|actorId|customerId|sessionId/,
    );
  });

  test('direct form tampering cannot choose customer, price, quantity or return destination', async ({
    page,
  }) => {
    await signUpMember(page.request);
    for (const operation of ['checkout', 'portal']) {
      const forged = await page.request.post(`/api/billing/${operation}`, {
        headers: { origin },
        form: {
          customer: 'cus_foreign',
          price: 'price_foreign',
          quantity: '2',
          return_url: 'https://evil.example',
        },
        maxRedirects: 0,
      });
      expect(forged.status()).toBe(400);
      expect(forged.headers().location).toBeUndefined();
      const foreign = await page.request.post(`/api/billing/${operation}`, {
        headers: { origin: 'https://evil.example' },
        form: {},
        maxRedirects: 0,
      });
      expect(foreign.status()).toBe(403);
      expect(foreign.headers().location).toBeUndefined();
    }
  });
});
