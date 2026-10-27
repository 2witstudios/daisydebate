import type { Browser } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { roomViewSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { launchCustomSelection } from './room-launch-custom';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { closeSettledLaunchContexts } from './room-launch-settled';

export async function proveLobbyDiscovery(browser: Browser) {
  // Three hosts: one user holds one active Room (ADR 0070).
  const accounts = await createRoomLaunchAccounts(browser, 3);
  let native: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const context = accounts.members[0]!.context;
    const token = `Discovery ${createId().slice(0, 8)}`;
    const views = [];
    for (let i = 0; i < 3; i++) {
      const response = await accounts.members[i]!.context.request.post(
        '/api/rooms',
        {
          headers: { origin },
          data: {
            commandId: createId(),
            title: `${token} ${i}`,
            topic: `Search paging topic ${i}`,
            visibility: 'public',
            selection: launchCustomSelection,
          },
        },
      );
      expect(response.status()).toBe(201);
      views.push(roomViewSchema.parse((await response.json()).view));
    }
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
    const rooms = page.getByRole('region', { name: 'Available rooms' });
    const listed = (title: string) => rooms.getByText(title, { exact: true });
    const visited = new Set<string>();
    let firstTitle = '';
    let previousTitle = '';
    for (let index = 0; index < views.length; index++) {
      if (previousTitle) await expect(listed(previousTitle)).toHaveCount(0);
      await expect(rooms.getByRole('listitem')).toHaveCount(1);
      const matching = [];
      for (const view of views)
        if (await listed(view.title).isVisible()) matching.push(view);
      expect(matching).toHaveLength(1);
      const view = matching[0]!;
      expect(visited.has(view.id)).toBe(false);
      visited.add(view.id);
      firstTitle ||= view.title;
      previousTitle = view.title;
      if (index < views.length - 1) {
        const href = await page
          .getByRole('link', { name: 'Next page', exact: true })
          .getAttribute('href');
        expect(new URL(href!, origin).searchParams.get('cursor')).toBe(view.id);
        await page
          .getByRole('link', { name: 'Next page', exact: true })
          .click();
        await expect(page).toHaveURL(new URL(href!, origin).href);
      } else
        await expect(
          page.getByRole('link', { name: 'Next page', exact: true }),
        ).toHaveCount(0);
    }
    expect([...visited].sort()).toEqual(views.map((view) => view.id).sort());
    await page.getByRole('link', { name: 'First page', exact: true }).click();
    await expect(listed(firstTitle)).toBeVisible();
    await page.getByLabel('Search rooms').fill(`  ${views[2]!.title}  `);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    expect(new URL(page.url()).searchParams.has('cursor')).toBe(false);
    await expect(listed(views[2]!.title)).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Next page', exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Search rooms').fill(`${token} missing`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('No rooms match');
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
