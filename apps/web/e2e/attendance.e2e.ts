import type { BrowserContext, Page, Response } from '@playwright/test';
import {
  attendanceReceiptSchema,
  type AttendanceReceipt,
} from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  createHumanBallotRound,
  readBallotRound,
} from './support/human-ballot-round';

const receiptResponse = (roundId: string) => (response: Response) =>
  new URL(response.url()).pathname === `/api/rounds/${roundId}/check-in` &&
  response.request().method() === 'POST' &&
  response.status() === 200;
const receiptFrom = async (response: Response): Promise<AttendanceReceipt> =>
  attendanceReceiptSchema.parse(await response.json());
async function enterSpeech(
  context: BrowserContext,
  roundId: string,
  label: string,
) {
  const page = await openPage(context, label);
  const response = page.waitForResponse(receiptResponse(roundId));
  await page.goto(`/rounds/${roundId}/room`);
  return { page, receipt: await receiptFrom(await response) };
}
async function nextReceipt(
  page: Page,
  roundId: string,
  action: () => Promise<unknown>,
) {
  const pending = page.waitForResponse(receiptResponse(roundId));
  await action();
  return receiptFrom(await pending);
}

test('actual speech check-in survives refresh and a real browser network disconnect without changing its first stamp', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    await expect
      .poll(
        async () =>
          (
            await readBallotRound(
              accounts.members[0]!.context.request,
              round.id,
            )
          ).segments.some((segment) => segment.type === 'speech'),
        { timeout: 10_000 },
      )
      .toBe(true);
    const [speaker, opponent] = await Promise.all(
      accounts.members
        .slice(0, 2)
        .map((member, index) =>
          enterSpeech(member.context, round.id, `attendance debater ${index}`),
        ),
    );
    expect(speaker!.receipt.segmentId).toBe(opponent!.receipt.segmentId);
    expect(speaker!.receipt.participantId).not.toBe(
      opponent!.receipt.participantId,
    );
    const refreshed = await nextReceipt(speaker!.page, round.id, () =>
      speaker!.page.reload(),
    );
    expect(refreshed.receivedAt).toBe(speaker!.receipt.receivedAt);
    expect(refreshed.replayed).toBe(true);
    await accounts.members[0]!.context.setOffline(true);
    const rejoined = await nextReceipt(speaker!.page, round.id, () =>
      accounts.members[0]!.context.setOffline(false),
    );
    expect(rejoined.receivedAt).toBe(speaker!.receipt.receivedAt);
    expect(
      (await readBallotRound(accounts.members[1]!.context.request, round.id))
        .status,
    ).toBe('active');
    const judge = await accounts.members[2]!.context.request.post(
      `/api/rounds/${round.id}/check-in`,
      {
        headers: { origin: new URL(speaker!.page.url()).origin },
        data: {
          version: 1,
          commandId: speaker!.receipt.commandId,
          segmentId: speaker!.receipt.segmentId,
        },
      },
    );
    expect(judge.status()).toBe(403);
  } finally {
    await accounts.closeContexts();
  }
});

for (const attendance of ['opponent-only', 'neither'] as const)
  test(`production attendance maintenance resolves ${attendance} from real HTTP receipts and settled public availability`, async ({
    browser,
  }) => {
    const accounts = await createRoomLaunchAccounts(browser, 4);
    try {
      const host = accounts.members[0]!.context;
      const round = await createHumanBallotRound(accounts.members);
      await expect
        .poll(
          async () =>
            (await readBallotRound(host.request, round.id)).segments.some(
              (segment) => segment.type === 'speech',
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
      if (attendance === 'opponent-only')
        await enterSpeech(
          accounts.members[1]!.context,
          round.id,
          'present opponent',
        );
      await expect
        .poll(
          async () => (await readBallotRound(host.request, round.id)).status,
          { timeout: 60_000, intervals: [500] },
        )
        .toBe(attendance === 'neither' ? 'abandoned' : 'completed');
      const completed = await readBallotRound(host.request, round.id);
      expect(completed.outcome).toBe(
        attendance === 'neither' ? null : 'negative',
      );
      expect(completed.segments.at(-1)?.endedAt).toEqual(expect.any(String));
    } finally {
      await accounts.closeContexts();
    }
  });
