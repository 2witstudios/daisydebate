import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page } from '@playwright/test';
import { isNamedSeat } from '@daisy/protocol';
import { origin } from './accounts';
import { watchCspViolations } from './csp';
import { expect, test as base, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { prepareRoomAs, readyUp } from './room-launch-flow';
import { settledLaunchAuth } from './room-launch-settled';
import { currentRoundForfeit, readBallotRound } from './human-ballot-round';

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
export const test = base.extend<{
  roundFiles: RoundFiles;
  roundCommands: boolean;
}>({
  roundCommands: [false, { option: true }],
  roundFiles: async ({ browser, roundCommands }, provide) => {
    const accounts = await createRoomLaunchAccounts(browser, 2);
    let launched: string | undefined;
    try {
      await accounts.members[0]!.context.grantPermissions(
        ['camera', 'microphone'],
        { origin },
      );
      const page = await openPage(
        accounts.members[0]!.context,
        'persisted Round files',
      );
      const prepared = await prepareRoomAs(
        page,
        `Round files ${createId().slice(0, 8)}`,
        'Affirmative 1',
      );
      if (roundCommands) {
        const configured = await page.request.post(
          `/api/rooms/${prepared.id}/commands`,
          {
            headers: { origin },
            data: {
              commandId: createId(),
              expectedVersion: prepared.version,
              type: 'update-config',
              config: {
                ...prepared.config,
                inRoundPrep: { enabled: true, budgetMsPerSide: 120000 },
                speechTiming: {
                  ...prepared.config.speechTiming,
                  countdownMs: 30000,
                },
                interruptions: { mode: 'cross_ex_only', minRemainingMs: 0 },
                yielding: { allowed: true, returnsTime: true },
              },
            },
          },
        );
        expect(configured.status()).toBe(200);
      }
      await page.reload();
      await readyUp(page);
      await page
        .getByRole('button', { name: 'Start round', exact: true })
        .click();
      await expect(page).toHaveURL(/\/rounds\/[a-z0-9]+\/room$/);
      const roundId = new URL(page.url()).pathname.split('/').at(-2)!;
      launched = roundId;
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
        if (launched)
          await forfeitAsHost(accounts.members[0]!.context.request, launched);
        await settledLaunchAuth();
      } finally {
        await accounts.closeContexts();
      }
    }
  },
});

/**
 * The host, seated as Affirmative 1, forfeits its fixture Round. A scheduled
 * Round becomes abandoned with its history kept, so it stops holding one of the
 * suite's shared bot Round slots (AI_ROUND_BUSY_CAP); left scheduled, every
 * Launch after the cap was refused and its fixture timed out (ISSUE-471-r1).
 */
async function forfeitAsHost(request: APIRequestContext, roundId: string) {
  const view = await readBallotRound(request, roundId);
  if (view.status !== 'scheduled' && view.status !== 'active') return;
  const seat = view.participants
    .filter(isNamedSeat)
    .find((p) => p.role === 'affirmative' && p.slot === 0)!;
  await currentRoundForfeit(request, roundId, seat.id);
}
