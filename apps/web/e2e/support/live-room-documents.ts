import { createId } from '@paralleldrive/cuid2';
import type { APIRequestContext, Page } from '@playwright/test';
import { origin } from './accounts';
import { watchCspViolations } from './csp';
import { expect, test as base, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import {
  prepareRoomAs,
  readyUp,
  startRoundInBrowser,
} from './room-launch-flow';
import { settledLaunchAuth } from './room-launch-settled';
import { forfeitOwnSeat } from './settle-left-round';

export { expect };

export const documentsPath = '/api/documents/';
/** Create a real authenticated document through its canonical document API. */
export const createMemberDocument = async (request: APIRequestContext) => {
  const response = await request.post(`${documentsPath}create`, {
    headers: { origin },
    data: { folderId: null },
  });
  expect(response.status()).toBe(201);
  const { document } = await response.json();
  expect(document.id).toMatch(/^[a-z0-9]{24}$/);
  return document;
};
/** A second real Round for same-principal receipt navigation; always release its competitive slot. */
export const documentFromFinishedRound = async (page: Page) => {
  await prepareRoomAs(
    page,
    `Notes lifetime ${createId().slice(0, 8)}`,
    'Affirmative 1',
  );
  await readyUp(page);
  const roundId = await startRoundInBrowser(page);
  try {
    const document = await createMemberDocument(page.request);
    return {
      roundId,
      documentId: document.id as string,
      title: document.title as string,
    };
  } finally {
    await forfeitAsHost(page.request, roundId);
  }
};
type LiveRoom = {
  readonly page: Page;
  readonly stranger: APIRequestContext;
  readonly roundId: string;
  readonly documentId: string;
  /** Ends the Round on the server; the page finds out in its own time. */
  readonly forfeitRound: () => Promise<void>;
  /** Ends the Round and leaves the page on its result. */
  readonly finishRound: () => Promise<void>;
  readonly violations: Awaited<ReturnType<typeof watchCspViolations>>;
};
/** A launched round with one server-saved document, opened by its first debater. */
export const test = base.extend<{
  liveRoom: LiveRoom;
  roundCommands: boolean;
}>({
  roundCommands: [false, { option: true }],
  liveRoom: async ({ browser, roundCommands }, provide) => {
    const accounts = await createRoomLaunchAccounts(browser, 2);
    let launched: string | undefined;
    let finished = false;
    try {
      await accounts.members[0]!.context.grantPermissions(
        ['camera', 'microphone'],
        { origin },
      );
      const page = await openPage(accounts.members[0]!.context, 'a live room');
      const prepared = await prepareRoomAs(
        page,
        `Live room ${createId().slice(0, 8)}`,
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
                  segmentDurationOverrides: { CX1: 30000 },
                },
                interruptions: { mode: 'enabled', minRemainingMs: 0 },
                yielding: { allowed: true, returnsTime: true },
              },
            },
          },
        );
        expect(configured.status()).toBe(200);
      }
      await page.reload();
      await readyUp(page);
      const roundId = await startRoundInBrowser(page);
      launched = roundId;
      const document = await createMemberDocument(page.request);
      expect(document.title).toBe('Untitled');
      const violations = await watchCspViolations(page);
      await page.reload();
      await expect(
        page.getByRole('textbox', { name: 'Untitled', exact: true }),
      ).toBeVisible();
      const forfeitRound = async () => {
        await forfeitAsHost(accounts.members[0]!.context.request, roundId);
        finished = true;
      };
      await provide({
        page,
        roundId,
        documentId: document.id,
        forfeitRound,
        finishRound: async () => {
          await forfeitRound();
          // The forfeit answers before this page hears of it, and a doorbell has
          // no delivery guarantee. Until then the Room can remove its editor at
          // any moment, so a journey goes on from the result page (ISSUE-966).
          await page.goto(`${origin}/rounds/${roundId}`);
          await expect(
            page.getByRole('heading', { name: 'Round result', exact: true }),
          ).toBeVisible();
        },
        violations,
        stranger: accounts.members[1]!.context.request,
      });
    } finally {
      // Competitive history stays in the dedicated slot until reviewed lifecycle release.
      try {
        if (launched && !finished)
          await forfeitAsHost(accounts.members[0]!.context.request, launched);
        await settledLaunchAuth();
      } finally {
        await accounts.closeContexts();
      }
    }
  },
});

/**
 * The host, seated as Affirmative 1, forfeits its fixture Round, so it stops
 * holding one of the suite's shared bot Round slots (AI_ROUND_BUSY_CAP); left
 * live, every Start round after the cap was refused and its fixture timed out
 * (ISSUE-471-r1).
 */
const forfeitAsHost = (request: APIRequestContext, roundId: string) =>
  forfeitOwnSeat(
    request,
    roundId,
    (seat) => seat.role === 'affirmative' && seat.slot === 0,
  );
