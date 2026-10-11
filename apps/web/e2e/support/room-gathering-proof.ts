import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import type { RoomView } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { reread } from './room-launch-flow';
import { assertNoSeriousFindings } from './axe';

/** Enter through actual discovery, including retained duplicate-title pages. */
export async function enterLobbyRoom(page: Page, view: RoomView) {
  const room = page
    .getByRole('list', { name: 'Available rooms' })
    .locator(`a[href="/rooms/${view.id}"]`);
  const visited = new Set<string>();
  while (!(await room.isVisible())) {
    const next = page.getByRole('link', { name: 'Next page', exact: true });
    await expect(next).toBeVisible();
    const href = await next.getAttribute('href');
    expect(href).not.toBeNull();
    expect(visited.has(href!)).toBe(false);
    visited.add(href!);
    await next.click();
    await expect(page).toHaveURL(new URL(href!, origin).href);
  }
  await expect(room).toBeVisible();
  await room.click();
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => scrollTo(0, 0));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await info.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

async function visualStates(page: Page, info: TestInfo) {
  for (const theme of ['light', 'dark'] as const) {
    await page
      .context()
      .addCookies([{ name: 'daisy-theme', value: theme, url: origin }]);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Take your places.' }),
      ).toBeVisible();
      for (const state of width === 1440 ? ['open', 'collapsed'] : ['open']) {
        if (state === 'collapsed') {
          await page
            .getByRole('button', { name: 'Collapse sidebar', exact: true })
            .click();
          await page
            .getByRole('button', { name: 'Collapse friends', exact: true })
            .click();
          await expect(page.locator('[data-nav]')).toHaveAttribute(
            'data-nav',
            'collapsed',
          );
          await expect(page.locator('[data-dock]')).toHaveAttribute(
            'data-dock',
            'closed',
          );
        }
        if (width !== 390) await assertNoSeriousFindings(page);
        await capture(page, info, `room-${theme}-${width}-${state}`);
        await page.getByText('Edit round settings', { exact: true }).click();
        await expect(
          page.getByRole('form', { name: 'Room settings' }),
        ).toBeVisible();
        if (width !== 390) await assertNoSeriousFindings(page);
        await capture(page, info, `room-edit-${theme}-${width}-${state}`);
        await page.getByText('Edit round settings', { exact: true }).click();
      }
    }
  }
}

async function sidebarState(page: Page, view: RoomView) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/rooms/${view.id}`);
  for (const state of ['collapsed', 'auto']) {
    await page
      .getByRole('button', {
        name: state === 'collapsed' ? 'Collapse sidebar' : 'Expand sidebar',
        exact: true,
      })
      .click();
    await page
      .locator('.room-page')
      .getByRole('link', { name: '‹ Lobby', exact: true })
      .click();
    await expect(page.locator('[data-nav]')).toHaveAttribute('data-nav', state);
    await enterLobbyRoom(page, view);
    await expect(
      page.getByRole('heading', { name: view.topic, exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-nav]')).toHaveAttribute('data-nav', state);
  }
}

/** Real saved custom Room and native server action, never a simulated Canvas interaction. */
export async function proveGathering(
  browser: Browser,
  context: BrowserContext,
  page: Page,
  view: RoomView,
  info: TestInfo,
) {
  const native = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await context.storageState(),
  });
  try {
    const room = await openPage(native, 'native exact Room durations');
    await room.goto(`/rooms/${view.id}`);
    await room.getByText('Edit round settings', { exact: true }).click();
    const form = room.getByRole('form', { name: 'Room settings' });
    // Both component constraints pass; the combined value exceeds the pinned 60s bound.
    await form.locator('[name="duration.segment.A2.minutes"]').fill('1');
    await form.locator('[name="duration.segment.A2.seconds"]').fill('03.456');
    const before = await reread(native.request, view.id);
    await form.getByRole('button', { name: 'Save settings' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(
      form.locator('[name="duration.segment.A2.seconds"]'),
    ).toHaveValue('03.456');
    expect((await reread(native.request, view.id)).config).toEqual(
      before.config,
    );
    expect(new URL(room.url()).search).toBe('');
    await form.locator('[name="duration.segment.A2.minutes"]').fill('0');
    await form.locator('[name="duration.segment.A2.seconds"]').fill('23.456');
    await form.getByRole('button', { name: 'Save settings' }).click();
    const saved = await reread(native.request, view.id);
    expect(saved.rules.segments.map((segment) => segment.durationMs)).toEqual([
      7000, 23456, 11000,
    ]);
    await room.getByText('Edit round settings', { exact: true }).click();
    await expect(
      form.locator('[name="duration.segment.A2.minutes"]'),
    ).toHaveValue('0');
    await expect(
      form.locator('[name="duration.segment.A2.seconds"]'),
    ).toHaveValue('23.456');
    expect(new URL(room.url()).search).toBe('');
  } finally {
    await native.close();
  }
  await sidebarState(page, view);
  await visualStates(page, info);
}
