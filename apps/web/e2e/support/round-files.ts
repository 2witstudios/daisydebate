import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page } from '@playwright/test';
import { origin } from './accounts';
import { watchCspViolations } from './csp';
import { expect, test as base, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { prepareRoomAs } from './room-launch-flow';
import { settledLaunchAuth } from './room-launch-settled';

export { expect };

export const documentsPath = '/api/debate-room/documents/';
type RoundFiles = {
  readonly page: Page;
  readonly stranger: APIRequestContext;
  readonly roundId: string;
  readonly documentId: string;
  readonly violations: Awaited<ReturnType<typeof watchCspViolations>>;
};
/** A launched round with one server-saved Flow, opened by its first debater. */
export const test = base.extend<{ roundFiles: RoundFiles }>({
  roundFiles: async ({ browser }, provide) => {
    const accounts = await createRoomLaunchAccounts(browser, 2);
    try {
      await accounts.members[0]!.context.grantPermissions(
        ['camera', 'microphone'],
        { origin },
      );
      const page = await openPage(
        accounts.members[0]!.context,
        'persisted Round files',
      );
      await prepareRoomAs(
        page,
        `Round files ${createId().slice(0, 8)}`,
        'Affirmative 1',
      );
      await page.reload();
      for (const device of ['camera', 'microphone'])
        await page
          .getByRole('button', { name: `Check ${device}`, exact: true })
          .click();
      await page
        .getByRole('button', { name: 'I am ready', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Not ready', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Launch', exact: true }).click();
      await expect(page).toHaveURL(/\/rounds\/[a-z0-9]+\/room$/);
      const roundId = new URL(page.url()).pathname.split('/').at(-2)!;
      const created = await page.request.post(`${documentsPath}create`, {
        headers: { origin },
        data: { roundId, folder: 'round', templateId: 'flow' },
      });
      expect(created.status()).toBe(201);
      const { document } = await created.json();
      expect(document.id).toMatch(/^[a-z0-9]{24}$/);
      expect(document.title).toBe('Flow');
      const violations = await watchCspViolations(page);
      await page.reload();
      await expect(
        page.getByRole('textbox', { name: 'Flow', exact: true }),
      ).toBeVisible();
      await provide({
        page,
        roundId,
        documentId: document.id,
        violations,
        stranger: accounts.members[1]!.context.request,
      });
    } finally {
      // Competitive history stays in the dedicated slot until reviewed lifecycle release.
      try {
        await settledLaunchAuth();
      } finally {
        await accounts.closeContexts();
      }
    }
  },
});
