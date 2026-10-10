import type { Browser } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { launchCustomSelection } from './room-launch-custom';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { closeSettledLaunchContexts } from './room-launch-settled';

export async function proveLobbyDiscovery(browser: Browser) {
  const accounts = await createRoomLaunchAccounts(browser, 1);
  let native: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const context = accounts.members[0]!.context;
    const token = `Discovery ${createId().slice(0, 8)}`;
    const views = [];
    for (let i = 0; i < 3; i++) {
      const response = await context.request.post('/api/rooms', {
        headers: { origin },
        data: {
          commandId: createId(),
          title: `${token} ${i}`,
          topic: `Search paging topic ${i}`,
          visibility: 'public',
          selection: launchCustomSelection,
        },
      });
      expect(response.status()).toBe(201);
      views.push(roomViewSchema.parse((await response.json()).view));
    }
    views.sort((a, b) => (a.id < b.id ? -1 : 1));
    native = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
      storageState: await context.storageState(),
    });
    const page = await openPage(native, 'native Lobby paging');
    await page.goto(
      `/lobby?${new URLSearchParams({ q: `  ${token}  `, pageSize: '1', utm_source: 'native-proof', next: '/lobby' })}`,
    );
    for (const [index, view] of views.entries()) {
      await expect(
        page.getByRole('link', { name: view.title, exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole('list', { name: 'Available rooms' })
          .getByRole('listitem'),
      ).toHaveCount(1);
      if (index < views.length - 1) {
        const href = await page
          .getByRole('link', { name: 'Next page', exact: true })
          .getAttribute('href');
        expect(new URL(href!, origin).searchParams.get('cursor')).toBe(view.id);
        await page
          .getByRole('link', { name: 'Next page', exact: true })
          .click();
      } else
        await expect(
          page.getByRole('link', { name: 'Next page', exact: true }),
        ).toHaveCount(0);
    }
    await page.getByRole('link', { name: 'First page', exact: true }).click();
    await expect(
      page.getByRole('link', { name: views[0]!.title, exact: true }),
    ).toBeVisible();
    await page.getByLabel('Search rooms').fill(`  ${views[2]!.title}  `);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
    await expect(
      page.getByRole('link', { name: views[2]!.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Next page', exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Search rooms').fill(`${token} missing`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'No rooms match your search.',
    );
    for (const query of [
      'cursor=invalid',
      'pageSize=51',
      'pageSize=1&pageSize=2',
      'history=true',
      'pageSize=01',
      'q=a&q=b',
      'cursor=a&cursor=b',
      'utm_source=native-proof',
      'next=/lobby',
    ]) {
      const response = await native.request.get(`/api/rooms?${query}`);
      expect(response.status()).toBe(400);
    }
  } finally {
    await native?.close();
    await closeSettledLaunchContexts(accounts);
  }
}
