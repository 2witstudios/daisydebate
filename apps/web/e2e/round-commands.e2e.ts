import {
  closeSettledLaunchContexts,
  controlLaunch,
} from './support/room-launch-settled';
import { pointsOfInformationChoice } from './support/human-round-selection';
import {
  expectConnected,
  grantedDebaters,
  readMediaState,
} from './support/round-media';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import {
  createHumanBallotRound,
  currentRoundForfeit,
  readBallotRound,
} from './support/human-ballot-round';
import {
  affirmativeSide,
  negativeSide,
  sideOfSeat,
} from '@daisy/protocol/seats';
import { isNamedSeat, roundViewSchema } from '@daisy/protocol/round-view';
import { roomViewSchema } from '@daisy/protocol/room-read';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import { origin } from './support/accounts';
import { expect, test } from './support/live-room-documents';
import { openPage } from './support/fixtures';
test.use({ roundCommands: true });

test('prep, a speech and a bot’s cross-examination run from a second page and keep canonical state on reload (INTX-2, INTX-8, INTX-9)', async ({
  liveRoom,
}) => {
  // The clock plays a 30s countdown and cross-examination before the negative speaks.
  test.setTimeout(240_000);
  const { page, roundId } = liveRoom;
  const formPage = await openPage(page.context(), 'Round commands');
  try {
    const path = `/rounds/${roundId}/room`;
    const read = () => readBallotRound(page.request, roundId);
    await formPage.goto(path);
    expect((await read()).status).toBe('active');
    // In the countdown before the constructive, prep is taken now, not called ahead.
    await formPage
      .getByRole('button', { name: 'Take prep time', exact: true })
      .click();
    await expect(
      formPage.getByRole('button', {
        name: 'Start affirmative constructive',
        exact: true,
      }),
    ).toBeVisible();
    expect((await read()).checkpoint?.prep).toMatchObject({
      phase: 'running',
      side: affirmativeSide,
    });
    await formPage
      .getByRole('button', {
        name: 'Start affirmative constructive',
        exact: true,
      })
      .click();
    // The clock starts one microphone lead after prep ends.
    await expect(
      page.getByRole('button', { name: 'End speech', exact: true }),
    ).toBeEnabled({ timeout: 15_000 });
    const speaking = await read();
    expect(speaking.checkpoint?.prep.phase).not.toBe('running');
    // No bot offers a point of information, and the speaker never offers one.
    await expect(
      page.getByRole('button', { name: 'Offer POI', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'End speech', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm end speech', exact: true }),
    ).toBeVisible();
    expect((await read()).version).toBe(speaking.version);
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
    expect(yielded.version).toBeGreaterThan(speaking.version);
    expect(
      yielded.segments.find((s) => s.rulesSegmentKey === 'AC')?.endedAt,
    ).toEqual(expect.any(String));
    const prepAfterSpeech = yielded.checkpoint?.prep_consumed_ms;
    // The bot negative asks in CX1, and a bot cannot end it, so the person
    // answering may. It opens on a maintenance tick that advances the version:
    // post only once the form carries the canonical version.
    const endCrossEx = formPage.getByRole('button', {
      name: 'End cross-examination',
      exact: true,
    });
    await expect(async () => {
      const opened = await read();
      const crossEx = opened.segments.find(
        (segment) => segment.rulesSegmentKey === 'CX1',
      );
      expect(crossEx?.startedAt).toEqual(expect.any(String));
      expect(crossEx?.endedAt).toBeNull();
      await formPage.reload();
      await expect(endCrossEx).toBeEnabled();
      await expect(
        formPage
          .locator('form', { has: endCrossEx })
          .locator('input[name="expectedVersion"]'),
      ).toHaveValue(String(opened.version));
    }).toPass({ timeout: 45_000 });
    await endCrossEx.click();
    await formPage
      .getByRole('button', {
        name: 'Confirm end cross-examination',
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () =>
          (await read()).segments.find((s) => s.rulesSegmentKey === 'CX1')
            ?.endedAt ?? null,
      )
      .not.toBeNull();
    // Ending cross-examination early returns no time to prep (INTX-8).
    expect((await read()).checkpoint?.prep_consumed_ms).toEqual(
      prepAfterSpeech,
    );
    // The negative is a bot, so its speech takes no point of information.
    await expect(async () => {
      const opened = await read();
      expect(
        opened.segments.find((s) => s.rulesSegmentKey === 'NC')?.startedAt,
      ).toEqual(expect.any(String));
      await formPage.reload();
      await expect(
        formPage.getByRole('button', { name: 'Forfeit round', exact: true }),
      ).toBeEnabled();
      await expect(
        formPage.getByRole('button', { name: 'Offer POI', exact: true }),
      ).toHaveCount(0);
    }).toPass({ timeout: 60_000 });
    await page.reload();
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

test('a point of information is offered and declined, lapses, then is accepted and returns the floor by itself (INTX-14, INTX-18)', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const { round, speaker, listener } = await grantedDebaters(
      accounts.members,
      pointsOfInformationChoice,
    );
    const read = () => readBallotRound(speaker.context.request, round.id);
    const phase = async () =>
      (await read()).checkpoint?.point_of_information.phase;
    const [affirmative, negative] = await Promise.all(
      [
        [speaker, 'POI speaker'],
        [listener, 'POI offerer'],
      ].map(async ([member, label]) => {
        const page = await openPage(
          (member as typeof speaker).context,
          label as string,
        );
        await page.goto(`/rounds/${round.id}/room`);
        await expectConnected(page);
        return page;
      }),
    );
    const offer = negative!.getByRole('button', {
      name: 'Offer POI',
      exact: true,
    });
    const accept = affirmative!.getByRole('button', { name: /^Accept / });
    // Offers open 10 s into the constructive; the speaker is never offered one.
    await expect(offer).toBeEnabled({ timeout: 30_000 });
    await expect(
      affirmative!.getByRole('button', { name: 'Offer POI', exact: true }),
    ).toHaveCount(0);
    await offer.click();
    await expect(accept).toBeVisible();
    await expect(
      affirmative!.getByText('offers a point of information'),
    ).toBeVisible();
    await affirmative!
      .getByRole('button', { name: 'Decline POI', exact: true })
      .click();
    await expect.poll(phase).toBe('none');
    // An offer the speaker leaves unanswered sits down by itself after 5 s.
    await expect(offer).toBeEnabled();
    await offer.click();
    await expect.poll(phase).toBe('offered');
    await expect.poll(phase, { timeout: 20_000 }).toBe('none');
    await expect(accept).toHaveCount(0);
    // Accepted, both microphones are live; after 5 s the floor returns unasked.
    await expect(offer).toBeEnabled();
    await offer.click();
    await expect(accept).toBeVisible();
    await accept.click();
    await expect.poll(phase).toBe('speaking');
    const holder = (await read()).participants
      .filter(isNamedSeat)
      .find((p) => sideOfSeat(p.seat) === negativeSide)!;
    const accepted = await read();
    expect(accepted.checkpoint?.point_of_information).toMatchObject({
      phase: 'speaking',
      holder_participant_id: holder.id,
    });
    await expect(
      negative!.getByText('Your point of information', { exact: true }),
    ).toBeVisible();
    await expect(
      affirmative!.getByRole('button', { name: 'Resume speech', exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () => (await readMediaState(listener, round.id)).grants.publish,
      )
      .toContain('microphone');
    await expect.poll(phase, { timeout: 20_000 }).toBe('none');
    // The holder's microphone goes; the camera every debater keeps stays.
    await expect
      .poll(
        async () => (await readMediaState(listener, round.id)).grants.publish,
      )
      .not.toContain('microphone');
    expect((await readMediaState(speaker, round.id)).grants.publish).toContain(
      'microphone',
    );
    // The speech clock ran through every point: the constructive is still open.
    expect(
      (await read()).segments.find((s) => s.rulesSegmentKey === 'AC')?.endedAt,
    ).toBeNull();
    const own = accepted.participants
      .filter(isNamedSeat)
      .find((p) => sideOfSeat(p.seat) === affirmativeSide)!;
    await currentRoundForfeit(speaker.context.request, round.id, own.id);
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
