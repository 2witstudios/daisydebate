import { roomViewSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { test, expect, openPage } from './support/fixtures';
import { origin } from './support/accounts';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  foundationChoice,
  humanRoundSelection,
} from './support/human-round-selection';
import {
  currentRoundForfeit,
  seatAndReady,
  startAdmittedRound,
} from './support/human-ballot-round';
import {
  MEDIA_POLL,
  expectConnected,
  expectPeerCamera,
  grantMedia,
  installMediaCapture,
  readMediaState,
} from './support/round-media';

test('after a Round with Post-round feedback, the debaters and a judge stay on the call in their own rooms', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const [aff, neg, judge, otherJudge] = accounts.members;
    if (!aff || !neg || !judge || !otherJudge)
      throw new Error('Four actual members required');
    const created = await aff.context.request.post('/api/rooms', {
      headers: { origin },
      data: {
        commandId: createId(),
        title: 'Feedback round',
        resolution: { kind: 'custom', text: 'Cities should fund transit' },
        visibility: 'public',
        selection: humanRoundSelection(foundationChoice, 2, 0),
        postRoundCall: true,
      },
    });
    expect(created.status()).toBe(201);
    const room = await seatAndReady(
      roomViewSchema.parse((await created.json()).view),
      [
        { member: aff, role: 'affirmative', slot: 0 },
        { member: neg, role: 'negative', slot: 0 },
        { member: judge, role: 'judge', slot: 0 },
        { member: otherJudge, role: 'judge', slot: 1 },
      ],
    );
    const round = await startAdmittedRound(aff, room);
    expect(round.postRoundCall).toBe(true);
    await grantMedia(accounts.members);
    const affPage = await openPage(aff.context, 'affirmative');
    const negPage = await openPage(neg.context, 'negative');
    const judgePage = await openPage(judge.context, 'judge');
    await Promise.all(
      [affPage, negPage, judgePage].map((page) =>
        installMediaCapture(page, 'alternating'),
      ),
    );
    await Promise.all(
      [affPage, negPage, judgePage].map((page) =>
        page.goto(`/rounds/${round.id}/room`),
      ),
    );
    await Promise.all([expectConnected(affPage), expectConnected(negPage)]);
    const roundRoom = (await readMediaState(aff, round.id)).mediaRoomName;

    const seat = round.participants.find(
      (p) => 'actorId' in p && p.role === 'negative',
    );
    if (!seat || !('id' in seat)) throw new Error('Negative seat missing');
    const ended = await currentRoundForfeit(
      neg.context.request,
      round.id,
      seat.id,
    );
    expect(ended.status).toBe('completed');

    // Nobody is sent to the result: each room stays and says the call is on.
    for (const page of [affPage, negPage]) {
      await expect(page.getByText('Call ends', { exact: true })).toBeVisible(
        MEDIA_POLL,
      );
      await expect(
        page.getByRole('link', { name: 'See the result', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('Leave call', { exact: true }).first(),
      ).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(`/rounds/${round.id}/room`);
    }
    await expect(
      judgePage.getByRole('heading', { name: 'The round is over' }),
    ).toBeVisible(MEDIA_POLL);

    // The session moved to a room of its own, and every browser followed it.
    await expect
      .poll(
        async () => (await readMediaState(aff, round.id)).mediaRoomName,
        MEDIA_POLL,
      )
      .not.toBe(roundRoom);
    await Promise.all(
      [affPage, negPage, judgePage].map((page) => expectConnected(page)),
    );
    await expectPeerCamera(affPage);

    // The judge is seen and heard, by seat and never by name.
    const [debaterState, judgeState] = await Promise.all([
      readMediaState(aff, round.id),
      readMediaState(judge, round.id),
    ]);
    expect(debaterState.state).toBe('ready');
    expect(debaterState.grants.publish).toEqual(['camera', 'microphone']);
    expect(judgeState.grants).toEqual({
      publish: ['camera', 'microphone'],
      subscribe: true,
      hidden: false,
      capture: false,
    });
    expect(debaterState.callJudges?.length).toBeGreaterThanOrEqual(1);
    await expect(
      affPage.getByRole('figure').filter({ hasText: 'Judge' }).first(),
    ).toBeVisible(MEDIA_POLL);
    await expect(
      judgePage.getByRole('figure').filter({ hasText: 'You · Judge' }),
    ).toBeVisible(MEDIA_POLL);
    await affPage.screenshot({
      path: test.info().outputPath('debater-on-the-call.png'),
    });
    await judgePage.screenshot({
      path: test.info().outputPath('judge-on-the-call.png'),
      fullPage: true,
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
