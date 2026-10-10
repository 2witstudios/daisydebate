import { createId } from '@paralleldrive/cuid2';
import { expect, test } from './support/fixtures';
import { resetRateLimits, signUpMember } from './support/accounts';
import { closeRoom, createFromPlay } from './support/room-launch-flow';

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

const roomRows = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Available rooms' }).getByRole('listitem');

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
      const created = await createFromPlay(page, title);
      roomId = created.id;
      await page.goto('/lobby');
      await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
      const item = roomRows(page).filter({ hasText: title });
      await expect(item).toHaveCount(1);
      await expect(item).toContainText(created.topic);
      await expect(item).toContainText('Host:');
      await expect(item.getByRole('link', { name: title })).toHaveAttribute(
        'href',
        `/rooms/${created.id}`,
      );
    } finally {
      if (roomId) await closeRoom(page.request, roomId);
    }
  });

  test('search filters current public Room projections and preserves the query in the URL', async ({
    page,
  }) => {
    const ids: string[] = [];
    try {
      const first = await createFromPlay(
        page,
        `Blue ${createId().slice(0, 8)}`,
      );
      ids.push(first.id);
      const second = await createFromPlay(
        page,
        `Gold ${createId().slice(0, 8)}`,
      );
      ids.push(second.id);

      await page.goto(`/lobby?q=${encodeURIComponent(second.title)}`);
      await expect(page).toHaveURL(
        new RegExp(`/lobby\\?q=${encodeURIComponent(second.title)}`),
      );
      await expect(roomRows(page)).toHaveCount(1);
      await expect(roomRows(page).first()).toContainText(second.title);
      await expect(roomRows(page).first()).not.toContainText(first.title);
    } finally {
      for (const id of ids) await closeRoom(page.request, id);
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
      await expect(page.getByRole('status')).toHaveText(
        'No rooms match your search.',
      );
      await expect(roomRows(page)).toHaveCount(0);
    } finally {
      if (roomId) await closeRoom(page.request, roomId);
    }
  });
});

test.describe('Room lobby with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test.beforeEach(async ({ page }) => {
    await signUpMember(page.request);
  });

  test('native creation and search forms use the same durable Room list', async ({
    page,
  }) => {
    const title = `Native lobby ${createId().slice(0, 8)}`;
    let roomId: string | undefined;
    try {
      await page.goto('/play/room');
      const form = page.getByRole('form', { name: 'Create a room' });
      await form.getByLabel('Room name', { exact: true }).fill(title);
      await form.getByLabel('Debate topic').fill('Native lobby topic');
      await form
        .getByRole('button', { name: 'Create room', exact: true })
        .click();
      await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
      roomId = new URL(page.url()).pathname.split('/').at(-1)!;

      await page.goto('/lobby');
      await expect(roomRows(page).filter({ hasText: title })).toHaveCount(1);
      await page.getByRole('searchbox', { name: 'Search rooms' }).fill(title);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page).toHaveURL(/\/lobby\?q=/);
      await expect(roomRows(page)).toHaveCount(1);
      await expect(roomRows(page).first()).toContainText(title);
    } finally {
      if (roomId) await closeRoom(page.request, roomId);
    }
  });
});
