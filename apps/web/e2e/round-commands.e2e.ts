import { controlLaunch } from './support/room-launch-settled';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  createHumanBallotRound,
  currentRoundForfeit,
  readBallotRound,
} from './support/human-ballot-round';
import {
  affirmativeSide,
  isNamedSeat,
  negativeSide,
  roomViewSchema,
  roundViewSchema,
  sideOfSeat,
  winnerOutcome,
} from '@daisy/protocol';
import { origin } from './support/accounts';
import { expect, test } from './support/live-room-documents';
import { openPage } from './support/fixtures';
test.use({ roundCommands: true });

test('Start affirmative constructive and round controls on a second page retain canonical state on reload', async ({
  liveRoom,
}) => {
  // The clock plays a 30s cross-examination and countdown before the speech.
  test.setTimeout(240_000);
  const { page, roundId } = liveRoom;
  const formPage = await openPage(page.context(), 'Round commands');
  try {
    const path = `/rounds/${roundId}/room`;
    const read = () => readBallotRound(page.request, roundId);
    await formPage.goto(path);
    expect((await read()).status).toBe('active');
    await formPage
      .getByRole('button', { name: 'Take prep time', exact: true })
      .click();
    await expect(
      formPage.getByRole('button', {
        name: 'Start affirmative constructive',
        exact: true,
      }),
    ).toBeVisible();
    expect((await read()).checkpoint?.active_prep?.side).toBe(affirmativeSide);
    await formPage
      .getByRole('button', {
        name: 'Start affirmative constructive',
        exact: true,
      })
      .click();
    // The clock starts one microphone lead after prep ends.
    await expect(
      formPage.getByRole('button', { name: 'End speech', exact: true }),
    ).toBeEnabled({ timeout: 15_000 });
    const speaking = await read();
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
    await expect
      .poll(async () => (await read()).segments[0]?.endedAt)
      .not.toBeNull();
    // Cross-examination has no Interrupt whatever the policy. The negative's
    // speech that follows does, under this Round's enabled policy. It opens on
    // a maintenance tick that advances the version: a page rendered before it
    // posts a stale expected version and is refused. Render it after the opening, and post it only once its form carries
    // the canonical version.
    const interrupt = formPage.getByRole('button', {
      name: 'Interrupt',
      exact: true,
    });
    await expect(async () => {
      const opened = await read();
      const crossEx = opened.segments.find(
        (segment) => segment.rulesSegmentKey === 'CX1',
      );
      expect(crossEx?.startedAt).toEqual(expect.any(String));
      await formPage.reload();
      await expect(interrupt).toHaveCount(0);
      // Read after rendering, so that page really showed the open segment.
      const after = (await read()).segments.find(
        (segment) => segment.rulesSegmentKey === 'CX1',
      );
      expect(after?.endedAt).toBeNull();
    }).toPass({ timeout: 45000 });
    await expect(async () => {
      const opened = await read();
      const speech = opened.segments.find(
        (segment) => segment.rulesSegmentKey === 'NC',
      );
      expect(speech?.startedAt).toEqual(expect.any(String));
      await formPage.reload();
      await expect(interrupt).toBeEnabled();
      await expect(
        formPage
          .locator('form', { has: interrupt })
          .locator('input[name="expectedVersion"]'),
      ).toHaveValue(String(opened.version));
    }).toPass({ timeout: 120000 });
    await interrupt.click();
    await expect
      .poll(async () => (await read()).checkpoint?.floor ?? null)
      .not.toBeNull();
    const interrupted = await read();
    const human = interrupted.participants
      .filter(isNamedSeat)
      .find(
        (p) => p.kind === 'human' && sideOfSeat(p.seat) === affirmativeSide,
      )!;
    expect(interrupted.checkpoint?.floor?.holder_participant_id).toBe(human.id);
    await expect(
      page.getByRole('button', { name: 'End speech', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'End speech', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm end speech', exact: true }),
    ).toBeVisible();
    // The media session must outlive the phase change: the same nodes stay.
    await page
      .locator('[data-room-media="grid"]')
      .evaluate((grid) => Reflect.set(window, '__roomMediaGrid', grid));
    await page
      .getByRole('button', { name: 'Confirm end speech', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Done.' }),
    ).toBeVisible();
    expect(
      await page
        .locator('[data-room-media="grid"]')
        .evaluate((grid) => Reflect.get(window, '__roomMediaGrid') === grid),
    ).toBe(true);
    await expect(page.getByRole('region', { name: 'Attendance' })).toHaveCount(
      0,
    );
    await expect(page.getByText(/^Attendance /)).toHaveCount(0);
    // A full read lane refuses unrun work; it cannot retract the accepted yield.
    await controlLaunch('refuse-round-reads');
    try {
      const refused = await page.request.get(`/api/rounds/${roundId}`);
      expect(refused.status()).toBe(503);
      expect(refused.headers()['retry-after']).toBe('1');
    } finally {
      await controlLaunch('allow-round-reads');
    }
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
    expect(final.outcome).toEqual(winnerOutcome(negativeSide));
    expect(new URL(formPage.url()).search).toBe('');
  } finally {
    await formPage.close();
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

test('a fresh Room creates a new cast after an actual result', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    const host = accounts.members[0]!.context;
    const live = await createHumanBallotRound(accounts.members);
    // Maintenance can open the first speech before the Launch receipt is read.
    await expect
      .poll(async () =>
        (await readBallotRound(host.request, live.id)).segments.some(
          (segment) => segment.type === 'speech' && segment.endedAt === null,
        ),
      )
      .toBe(true);
    const seat = live.participants
      .filter(isNamedSeat)
      .find((p) => sideOfSeat(p.seat) === affirmativeSide)!;
    const ended = await currentRoundForfeit(host.request, live.id, seat.id);
    context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      storageState: await host.storageState(),
    });
    const page = await openPage(context, 'fresh Room after durable result');
    await page.goto(`/rooms/${live.roomId}`);
    await page
      .getByRole('link', { name: 'Create a new room', exact: true })
      .click();
    await expect(page).toHaveURL(`/rooms/${live.roomId}/rematch`);
    await expect(
      page.getByRole('heading', { name: 'Create a new room', exact: true }),
    ).toBeVisible();
    const form = page.getByRole('form', {
      name: 'Create a room',
      exact: true,
    });
    await expect(form.getByLabel('Room name', { exact: true })).toHaveValue('');
    await expect(
      form.locator('[name="format"][value="freestyle"]'),
    ).toBeChecked();
    await expect(
      form.getByRole('combobox', { name: 'Resolution', exact: true }),
    ).toHaveValue('strike');
    await form
      .getByLabel('Room name', { exact: true })
      .fill('A genuinely fresh Room');
    await form
      .getByRole('combobox', { name: 'Resolution', exact: true })
      .selectOption('custom');
    await form
      .getByLabel('Custom resolution', { exact: true })
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
