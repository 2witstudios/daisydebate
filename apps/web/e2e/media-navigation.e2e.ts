import { createId } from '@paralleldrive/cuid2';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';
import { enterLobbyRoom } from './support/room-gathering-proof';
import { claim, closeRoom, createFromPlay } from './support/room-launch-flow';

// A media page's Permissions-Policy binds to the document it was loaded as,
// so these journeys arrive by in-app navigation, never page.goto (ISSUE-564).
// Full Chromium's headless mode captures the fake media stream.
test.use({ channel: 'chromium' });

test.beforeEach(async ({ page }) => {
  await resetRateLimits(page.request);
  await signUpMember(page.request);
  await page.context().grantPermissions(['camera', 'microphone'], { origin });
});

async function checkDevices(page: Page) {
  for (const [kind, label] of [
    ['camera', 'Camera'],
    ['microphone', 'Microphone'],
  ] as const) {
    await page
      .getByRole('button', { name: `Check ${kind}`, exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: `✓ ${label}` }),
    ).toBeVisible();
  }
}

test('a lobby click into a Room reaches a working camera and microphone', async ({
  page,
}) => {
  let roomId: string | undefined;
  try {
    const created = await createFromPlay(
      page,
      `Lobby media ${createId().slice(0, 8)}`,
    );
    roomId = created.id;
    await claim(page, created, 'Affirmative 1');
    await page.goto('/lobby');
    await enterLobbyRoom(page, created);
    await expect(page).toHaveURL(`/rooms/${created.id}`);
    await checkDevices(page);
  } finally {
    if (roomId) await closeRoom(page.request, roomId);
  }
});

test('creating a Room lands on it with a working camera and microphone', async ({
  page,
}) => {
  let roomId: string | undefined;
  try {
    const created = await createFromPlay(
      page,
      `Created media ${createId().slice(0, 8)}`,
    );
    roomId = created.id;
    await page
      .getByRole('button', { name: 'Take Affirmative 1', exact: true })
      .click();
    await checkDevices(page);
  } finally {
    if (roomId) await closeRoom(page.request, roomId);
  }
});
