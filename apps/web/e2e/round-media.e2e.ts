import {
  roundMediaAdmissionSchema,
  roundMediaStateSchema,
} from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { origin } from './support/accounts';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import {
  createHumanBallotRound,
  readBallotRound,
  ballotRoundCommand,
} from './support/human-ballot-round';

test('actual browser tracks reach an assigned hidden judge and terminal commit stops the local camera', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 4);
  try {
    const round = await createHumanBallotRound(accounts.members);
    const debaters = accounts.members.slice(0, 2);
    for (const member of debaters)
      await member.context.grantPermissions(['camera', 'microphone'], {
        origin,
      });
    const pages = await Promise.all(
      debaters.map((member, index) =>
        openPage(member.context, `media debater ${index + 1}`),
      ),
    );
    await Promise.all(
      pages.map((page) => page.goto(`/rounds/${round.id}/room`)),
    );
    for (const page of pages) {
      await expect(
        page.getByRole('status').filter({ hasText: /^Connected$/ }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Enable sound', exact: true })
        .click();
      await expect
        .poll(() =>
          page
            .getByLabel('Participant camera', { exact: true })
            .evaluateAll((nodes) =>
              nodes.some((node) => {
                const video = node as HTMLVideoElement;
                return video.videoWidth > 0 && video.readyState >= 2;
              }),
            ),
        )
        .toBe(true);
    }
    const judge = accounts.members[2]!;
    await judge.context.clearPermissions();
    const judgePage = await openPage(judge.context, 'assigned judge media');
    const admission = judgePage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/rounds/${round.id}/media/session` && response.status() === 200,
    );
    await judgePage.goto(`/rounds/${round.id}/room`);
    const own = roundMediaAdmissionSchema.parse(await (await admission).json());
    expect(own.grants).toEqual({
      publish: [],
      subscribe: true,
      hidden: true,
      capture: false,
    });
    await expect(
      judgePage.getByRole('status').filter({ hasText: /^Connected$/ }),
    ).toBeVisible();
    await expect(
      judgePage.getByLabel('Your camera', { exact: true }),
    ).toHaveCount(0);
    await expect(judgePage.getByRole('figure')).toHaveCount(2);
    await judgePage
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expect
      .poll(() =>
        judgePage.getByLabel('Participant camera', { exact: true }).evaluateAll(
          (nodes) =>
            nodes.filter((node) => {
              const video = node as HTMLVideoElement;
              return video.videoWidth > 0 && video.readyState >= 2;
            }).length,
        ),
      )
      .toBe(2);
    await expect
      .poll(() =>
        judgePage
          .getByLabel('Participant audio', { exact: true })
          .evaluateAll((nodes) =>
            nodes.some((node) => {
              const audio = node as HTMLAudioElement;
              const stream = audio.srcObject as MediaStream | null;
              return (
                !audio.paused &&
                audio.readyState >= 2 &&
                stream
                  ?.getAudioTracks()
                  .some((track) => track.readyState === 'live')
              );
            }),
          ),
      )
      .toBe(true);
    for (const member of debaters) {
      const response = await member.context.request.get(
        `/api/rounds/${round.id}/media`,
      );
      expect(response.status()).toBe(200);
      const state = roundMediaStateSchema.parse(await response.json());
      expect(state.peers.some((peer) => peer.identity === own.identity)).toBe(
        false,
      );
    }
    const local = await pages[0]!
      .getByLabel('Your camera', { exact: true })
      .evaluateHandle(
        (node) => (node as HTMLVideoElement).srcObject as MediaStream,
      );
    const fresh = await readBallotRound(debaters[0]!.context.request, round.id);
    const seat = fresh.participants.find(
      (participant) =>
        participant.role === 'affirmative' && 'id' in participant,
    );
    if (!seat || !('id' in seat))
      throw new Error('Actual debater seat missing');
    await ballotRoundCommand(debaters[0]!.context.request, fresh, {
      type: 'forfeit',
      participantId: seat.id,
    });
    await expect
      .poll(() =>
        local.evaluate((stream) =>
          stream.getVideoTracks().map((track) => track.readyState),
        ),
      )
      .toEqual(['ended']);
    await local.dispose();
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
