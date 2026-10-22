import type { Browser } from '@playwright/test';
import { attendanceReceiptSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { createRoomLaunchAccounts } from './room-launch-accounts';
import { origin } from './accounts';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './human-ballot-round';
import { attendanceEvidence } from './attendance-evidence';
import {
  actualSpeech,
  enterSpeech,
  healthyAttendance,
  pastOriginalAttendanceGrace,
  attendedResolution,
} from './attendance-browser';
import {
  controlLaunch,
  closeSettledLaunchContexts,
} from './room-launch-settled';

export async function nativeAttendanceOutage({
  browser,
}: {
  readonly browser: Browser;
}) {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  const host = accounts.members[0]!.context;
  const native = await browser.newContext({
    baseURL: origin,
    javaScriptEnabled: false,
    ignoreHTTPSErrors: false,
    storageState: await host.storageState(),
  });
  try {
    const round = await createHumanBallotRound(accounts.members);
    const speech = await actualSpeech(host.request, round.id);
    await enterSpeech(
      accounts.members[1]!.context,
      round.id,
      'opponent present during public outage',
    );
    const page = await openPage(native, 'native delayed explicit attendance');
    const stale = await openPage(native, 'native stale attendance form');
    await Promise.all([
      page.goto(`/rounds/${round.id}/room`),
      stale.goto(`/rounds/${round.id}/room`),
    ]);
    const button = page.getByRole('button', {
      name: 'Record attendance for this speech',
      exact: true,
    });
    await expect(button).toBeVisible();
    const commandId = await page
      .locator('form', { has: button })
      .locator('input[name="commandId"]')
      .inputValue();
    await healthyAttendance(round.id);
    await controlLaunch('block-check-in');
    await expect
      .poll(
        async () => (await attendanceEvidence(round.id)).samples.at(-1)?.cause,
        { timeout: 10_000 },
      )
      .toBe('public_probe_failed');
    await pastOriginalAttendanceGrace(round.id, speech.startedAt);
    const postponed = await attendanceEvidence(round.id);
    expect(postponed.status).toBe('active');
    expect(postponed.adjudications).toEqual([]);
    await controlLaunch('restore-check-in');
    await button.click();
    await expect(
      page.getByRole('heading', { name: 'Attendance recorded', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Return to the round', exact: true }),
    ).toBeVisible();
    const replay = await host.request.post(`/api/rounds/${round.id}/check-in`, {
      headers: { origin },
      data: { version: 1, commandId, segmentId: speech.id },
    });
    expect(replay.status()).toBe(200);
    const received = attendanceReceiptSchema.parse(await replay.json());
    expect(received.replayed).toBe(true);
    expect(
      Date.parse(received.receivedAt) - Date.parse(speech.startedAt),
    ).toBeGreaterThan(40_000);
    await page
      .getByRole('link', { name: 'Return to the round', exact: true })
      .click();
    await expect(
      page.getByText('Attendance recorded for Affirmative constructive.', {
        exact: true,
      }),
    ).toBeVisible();
    await attendedResolution(round.id, speech.id);
    const before = await attendanceEvidence(round.id);
    expect(before.status).toBe('active');
    expect(before.samples.slice(-3).map((sample) => sample.healthy)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      before.receipts.find((row) => row.commandId === commandId)?.receivedAt,
    ).toBe(received.receivedAt);
    const refused = stale.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/rounds/${round.id}/check-in` &&
        response.request().method() === 'POST',
    );
    await stale
      .getByRole('button', {
        name: 'Record attendance for this speech',
        exact: true,
      })
      .click();
    expect((await refused).status()).toBe(409);
    await expect(
      stale.getByRole('heading', {
        name: 'Attendance not recorded',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      stale.getByRole('link', { name: 'Return to the round', exact: true }),
    ).toBeVisible();
    const after = await attendanceEvidence(round.id);
    expect([
      after.status,
      after.version,
      after.checkInCommands,
      after.receipts,
    ]).toEqual([
      before.status,
      before.version,
      before.checkInCommands,
      before.receipts,
    ]);
    // Explicit participant forfeit is separate from attendance settlement and remains available.
    const current = await readBallotRound(host.request, round.id);
    await ballotRoundCommand(host.request, current, {
      type: 'forfeit',
      participantId: received.participantId,
    });
  } finally {
    try {
      await controlLaunch('restore-check-in');
    } finally {
      await native.close();
      await closeSettledLaunchContexts(accounts);
    }
  }
}
