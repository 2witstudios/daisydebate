import { maintainHumanBallotFixtures } from './support/human-ballot-maintenance';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  createHumanBallotRound,
  currentRoundCommand,
  readBallotRound,
} from './support/human-ballot-round';
import { roomViewSchema, roundViewSchema, isNamedSeat } from '@daisy/protocol';
import { origin } from './support/accounts';
import { expect, test } from './support/round-files';
import { openPage } from './support/fixtures';
test.use({ roundCommands: true });

test('native Start AC and enhanced Round controls retain canonical state on reload', async ({
  roundFiles,
  browser,
}) => {
  const { page, roundId } = roundFiles;
  const native = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });
  try {
    const formPage = await openPage(native, 'native Round commands');
    const path = `/rounds/${roundId}/room`;
    const read = async () => {
      const response = await native.request.get(`/api/rounds/${roundId}`);
      expect(response.status()).toBe(200);
      return roundViewSchema.parse(await response.json());
    };
    await formPage.goto(path);
    await formPage
      .getByRole('button', { name: 'Start round', exact: true })
      .click();
    await expect(formPage).toHaveURL(path);
    expect((await read()).status).toBe('active');
    await formPage
      .getByRole('button', { name: 'Use prep', exact: true })
      .click();
    await expect(
      formPage.getByRole('button', { name: 'Start AC', exact: true }),
    ).toBeVisible();
    expect((await read()).checkpoint?.active_prep?.side).toBe('affirmative');
    await formPage
      .getByRole('button', { name: 'Start AC', exact: true })
      .click();
    await expect(
      formPage.getByRole('button', { name: 'End speech', exact: true }),
    ).toBeEnabled();
    const speaking = await read();
    const stalePage = await openPage(native, 'stale native Round command');
    await stalePage.goto(path);
    await stalePage
      .getByRole('button', { name: 'End speech', exact: true })
      .click();
    expect(speaking.checkpoint?.active_prep).toBeNull();
    await formPage
      .getByRole('button', { name: 'End speech', exact: true })
      .click();
    await expect(
      formPage.getByRole('button', {
        name: 'Confirm end speech',
        exact: true,
      }),
    ).toBeVisible();
    expect((await read()).version).toBe(speaking.version);
    await formPage
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    expect((await read()).segments[0]?.endedAt).not.toBeNull();
    const beforeRefusal = await read();
    await stalePage
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect(
      stalePage.getByText(
        'The round changed or that action is no longer legal. Review the current round and try again.',
        { exact: true },
      ),
    ).toBeVisible();
    expect((await read()).version).toBe(beforeRefusal.version);
    await stalePage.close();
    await expect(async () => {
      await formPage.reload();
      await expect(
        formPage.getByRole('button', { name: 'Interrupt', exact: true }),
      ).toBeEnabled();
    }).toPass({ timeout: 45000 });
    await formPage
      .getByRole('button', { name: 'Interrupt', exact: true })
      .click();
    const interrupted = await read();
    const human = interrupted.participants
      .filter(isNamedSeat)
      .find((p) => p.kind === 'human' && p.role === 'affirmative')!;
    expect(interrupted.checkpoint?.floor?.holder_participant_id).toBe(human.id);
    await expect(
      page.getByRole('button', { name: 'End speech', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'End speech', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm end speech', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Command accepted' }),
    ).toBeVisible();
    const yielded = await read();
    expect(yielded.version).toBeGreaterThan(interrupted.version);
    expect(yielded.checkpoint?.floor).toBeNull();
    await page.reload();
    expect((await read()).version).toBe(yielded.version);
    await formPage.reload();
    await formPage
      .getByRole('button', { name: 'Forfeit round', exact: true })
      .click();
    await formPage
      .getByRole('button', { name: 'Confirm forfeit round', exact: true })
      .click();
    await expect(formPage).toHaveURL(`/rounds/${roundId}`);
    const final = await read();
    expect(final.status).toBe('completed');
    expect(final.outcome).toBe('negative');
    expect(new URL(formPage.url()).search).toBe('');
  } finally {
    await native.close();
  }
});

test('native attendance records an actual opened speech through the mounted production POST', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  const host = accounts.members[0]!;
  const native = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    storageState: await host.context.storageState(),
  });
  try {
    const round = await createHumanBallotRound(accounts.members);
    await maintainHumanBallotFixtures([round.id]);
    const page = await openPage(native, 'native actual attendance');
    await page.goto(`/rounds/${round.id}/room`);
    const button = page.getByRole('button', {
      name: 'Record attendance for this speech',
      exact: true,
    });
    await expect(button).toBeVisible();
    const form = page.locator('form', { has: button });
    await expect(form).toHaveAttribute(
      'action',
      `/api/rounds/${round.id}/check-in`,
    );
    expect(await form.locator('input[name="commandId"]').inputValue()).toMatch(
      /^[a-z0-9]{20,32}$/,
    );
    await button.click();
    await expect(
      page.getByRole('heading', { name: 'Attendance recorded', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('link', { name: 'Return to the round', exact: true })
      .click();
    await expect(page).toHaveURL(`/rounds/${round.id}/room`);
    await expect(
      page.getByText('Attendance recorded for Affirmative constructive.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Record attendance for this speech',
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await native.close();
    await accounts.closeContexts();
  }
});

test('the mounted private capture boundary rejects GET, oversized bodies and invalid UTF-8 before storage', async ({
  request,
}) => {
  const path = `/api/internal/media/${'r'.repeat(24)}/capture/read`;
  expect((await request.get(path)).status()).toBe(405);
  const oversized = await request.post(path, {
    data: Buffer.alloc(128 * 1024 + 1, 120),
    headers: { 'content-type': 'application/json' },
  });
  expect(oversized.status()).toBe(413);
  expect(await oversized.json()).toMatchObject({
    error: { code: 'PAYLOAD_TOO_LARGE' },
  });
  const invalidUtf8 = await request.post(path, {
    data: Buffer.from([0xff]),
    headers: { 'content-type': 'application/json' },
  });
  expect(invalidUtf8.status()).toBe(400);
  expect(await invalidUtf8.json()).toMatchObject({
    error: { code: 'VALIDATION' },
  });
});

for (const javaScriptEnabled of [false, true])
  test(`${javaScriptEnabled ? 'enhanced' : 'native'} fresh Room creates a new cast after an actual result`, async ({
    browser,
  }) => {
    const accounts = await createRoomLaunchAccounts(browser, 4);
    let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
      const host = accounts.members[0]!.context;
      const live = await createHumanBallotRound(accounts.members);
      // Maintenance opens the first speech within a tick of start (ISSUE-489):
      // the command must land against the Round the clock has moved on.
      await expect
        .poll(
          async () => (await readBallotRound(host.request, live.id)).version,
        )
        .toBeGreaterThan(live.version);
      const seat = live.participants
        .filter(isNamedSeat)
        .find((p) => p.role === 'affirmative')!;
      const ended = await currentRoundCommand(host.request, live.id, {
        type: 'forfeit',
        participantId: seat.id,
      });
      context = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
        javaScriptEnabled,
        storageState: await host.storageState(),
      });
      const page = await openPage(context, 'fresh Room after durable result');
      await page.goto(`/rooms/${live.roomId}`);
      await page
        .getByRole('link', { name: 'Create a fresh Room', exact: true })
        .click();
      await expect(page).toHaveURL(`/rooms/${live.roomId}/rematch`);
      await expect(
        page.getByRole('heading', { name: 'Create a fresh Room', exact: true }),
      ).toBeVisible();
      const form = page.getByRole('form', {
        name: 'Create a room',
        exact: true,
      });
      await expect(form.getByLabel('Room name', { exact: true })).toHaveValue(
        '',
      );
      await expect(form.getByLabel('Debate topic')).toHaveValue('');
      await form
        .getByLabel('Room name', { exact: true })
        .fill('A genuinely fresh Room');
      await form
        .getByLabel('Debate topic')
        .fill('Libraries should remain public');
      await form
        .getByRole('button', { name: 'Create room', exact: true })
        .click();
      await expect(page).toHaveURL(/\/rooms\/[a-z0-9]+$/);
      const newId = new URL(page.url()).pathname.split('/').at(-1)!;
      expect(newId).not.toBe(live.roomId);
      const freshResponse = await context.request.get(`/api/rooms/${newId}`);
      expect(freshResponse.status()).toBe(200);
      const fresh = roomViewSchema.parse(await freshResponse.json());
      expect([
        fresh.participants.length,
        fresh.readiness.readyActorIds.length,
        fresh.roundRef,
      ]).toEqual([0, 0, null]);
      const oldResponse = await host.request.get(`/api/rounds/${live.id}`);
      expect(roundViewSchema.parse(await oldResponse.json())).toEqual(ended);
    } finally {
      await context?.close();
      await accounts.closeContexts();
    }
  });
