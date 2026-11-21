import { createId } from '@paralleldrive/cuid2';
import { systemClock } from '@daisy/clock';
import { expect, openPage, test } from './support/fixtures';
import {
  origin,
  resetRateLimits,
  signUpMember,
  youthBirth,
} from './support/accounts';
import {
  closeRoom,
  createFromPlay,
  setResolution,
} from './support/room-launch-flow';

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

const roomRows = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Available rooms' }).getByRole('listitem');

test.describe('authenticated Room lobby', () => {
  test.beforeEach(async ({ page }) => {
    await signUpMember(page.request);
  });

  test('lists the public Rooms created through the canonical Play flow', async ({
    page,
  }) => {
    const title = `Lobby ${createId().slice(0, 8)}`;
    let roomId: string | undefined;
    try {
      const created = await createFromPlay(
        page,
        title,
        'freestyle',
        setResolution,
      );
      roomId = created.id;
      await page.goto('/lobby');
      await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
      const item = roomRows(page).filter({ hasText: title });
      await expect(item).toHaveCount(1);
      await expect(item).toContainText(setResolution);
      // Watch sits beside the row's seat action (ADR 0156); both lead to the Room.
      await expect(
        item.getByRole('link', { name: /^Watch: / }),
      ).toHaveAttribute('href', `/rooms/${created.id}`);
      await expect(item.getByRole('link').last()).toHaveAttribute(
        'href',
        `/rooms/${created.id}`,
      );
    } finally {
      if (roomId) await closeRoom(page.request, roomId);
    }
  });

  test('search filters current public Room projections and preserves the query in the URL', async ({
    page,
    browser,
  }) => {
    // One user holds one active Room (ADR 0070): another member hosts the first.
    const other = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    let firstId: string | undefined, secondId: string | undefined;
    try {
      const token = createId().slice(0, 8);
      await signUpMember(other.request, youthBirth(systemClock.now()));
      const first = await createFromPlay(
        await openPage(other, 'Youth lobby host'),
        `Youth ${token}`,
      );
      firstId = first.id;
      const second = await createFromPlay(page, `Open ${token}`);
      secondId = second.id;

      await page.goto('/lobby');
      const lobbyLink = page
        .getByRole('navigation', { name: 'Lobby', exact: true })
        .getByRole('link', { name: 'Youth', exact: true });
      const lobbyHref = await lobbyLink.getAttribute('href');
      const lobbyId = new URL(lobbyHref ?? '', origin).searchParams.get(
        'lobby',
      );
      expect(lobbyId).toMatch(/^[a-z0-9]{24}$/);
      await lobbyLink.click();
      await expect(lobbyLink).toHaveAttribute('aria-current', 'page');
      await page.getByRole('searchbox', { name: 'Search rooms' }).fill(token);
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === '/lobby' &&
          url.searchParams.get('lobby') === lobbyId &&
          url.searchParams.get('q') === token,
      );
      await expect(roomRows(page)).toHaveCount(1);
      await expect(roomRows(page).first()).toContainText(first.title);
      await expect(roomRows(page).first()).not.toContainText(second.title);
    } finally {
      if (secondId) await closeRoom(page.request, secondId);
      if (firstId) await closeRoom(other.request, firstId);
      await other.close();
    }
  });

  test('a search with no matching Room explains the empty result', async ({
    page,
  }) => {
    let roomId: string | undefined;
    try {
      const created = await createFromPlay(
        page,
        `Existing ${createId().slice(0, 8)}`,
      );
      roomId = created.id;
      await page.goto('/lobby?q=not-a-real-room');
      await expect(page.getByRole('status')).toContainText('No rooms match');
      await expect(roomRows(page)).toHaveCount(0);
    } finally {
      if (roomId) await closeRoom(page.request, roomId);
    }
  });
});
