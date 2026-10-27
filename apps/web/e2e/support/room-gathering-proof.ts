import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import type { RoomView } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { origin } from './accounts';
import { closeRoomSetup, openRoomSetup, reread } from './room-launch-flow';
import { assertNoSeriousFindings } from './axe';
import { proveClosedRoomNavigation } from './room-shell-refresh-proof';

/** Enter through actual discovery, including retained duplicate-title pages. */
export async function enterLobbyRoom(page: Page, view: RoomView) {
  await expect(
    page.getByRole('heading', { name: 'Lobby', exact: true }),
  ).toBeVisible();
  const list = page.getByRole('region', { name: 'Available rooms' });
  await expect(list).toBeVisible();
  const room = list.locator(`a[href="/rooms/${view.id}"]`);
  const next = page.getByRole('link', { name: 'Next page', exact: true });
  const visited = new Set<string>();
  for (;;) {
    await expect(room.or(next).first()).toBeVisible();
    // Recheck after the rendered discovery controls arrive, never choose a
    // page based on a visibility read made before a navigation committed.
    if (await room.isVisible()) break;
    const first = list.getByRole('link').first();
    await expect(first).toBeVisible();
    const previousFirst = await first.getAttribute('href');
    expect(previousFirst).not.toBeNull();
    const href = await next.getAttribute('href');
    expect(href).not.toBeNull();
    expect(visited.has(href!)).toBe(false);
    visited.add(href!);
    await next.click();
    await expect(page).toHaveURL(new URL(href!, origin).href);
    await expect(first).not.toHaveAttribute('href', previousFirst!);
    await expect(first).toBeVisible();
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
        page.getByRole('heading', { name: 'Seats', exact: true }),
      ).toBeVisible();
      if (width !== 390) await assertNoSeriousFindings(page);
      await capture(page, info, `room-${theme}-${width}`);
      await expect(await openRoomSetup(page, true)).toBeVisible();
      if (width !== 390) await assertNoSeriousFindings(page);
      await capture(page, info, `room-edit-${theme}-${width}`);
      await closeRoomSetup(page);
    }
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
    const form = await openRoomSetup(room, true);
    // A well-formed m:ss value that exceeds the pinned 60s bound.
    await form.locator('[name="duration.segment.A2"]').fill('1:03.456');
    const before = await reread(native.request, view.id);
    await form.getByRole('button', { name: 'Save round settings' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(form.locator('[name="duration.segment.A2"]')).toHaveValue(
      '1:03.456',
    );
    expect((await reread(native.request, view.id)).config).toEqual(
      before.config,
    );
    expect(new URL(room.url()).search).toBe('');
    // A refused save keeps the sheet open; closing it returns to the room.
    await room
      .getByRole('link', { name: 'Close room setup', exact: true })
      .click();
    await expect(form).toBeHidden();
    await openRoomSetup(room, true);
    await form.locator('[name="duration.segment.A2"]').fill('0:43.456');
    await form.getByRole('button', { name: 'Save round settings' }).click();
    // The accepted native save's redirect closes Room setup.
    await expect(form).toBeHidden();
    const saved = await reread(native.request, view.id);
    expect(saved.rules.segments.map((segment) => segment.durationMs)).toEqual([
      41000, 43456, 47000,
    ]);
    await openRoomSetup(room, true);
    await expect(form.locator('[name="duration.segment.A2"]')).toHaveValue(
      '0:43.456',
    );
    expect(new URL(room.url()).search).toBe('');
  } finally {
    await native.close();
  }
  await visualStates(page, info);
  await proveClosedRoomNavigation(page);
}
