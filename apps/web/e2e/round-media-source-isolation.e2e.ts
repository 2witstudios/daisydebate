import { roundMediaStateSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import { createRoomLaunchAccounts } from './support/room-launch-accounts';
import { closeSettledLaunchContexts } from './support/room-launch-settled';
import { createHumanBallotRound } from './support/human-ballot-round';
import {
  MEDIA_POLL,
  grantMedia,
  installMediaCapture,
} from './support/round-media';

test('a camera capture failure after Ready keeps permitted microphone audio reaching the peer', async ({
  browser,
}) => {
  const accounts = await createRoomLaunchAccounts(browser, 2);
  try {
    const round = await createHumanBallotRound(accounts.members, 0);
    const [speaker, listener] = accounts.members;
    if (!speaker || !listener) throw new Error('Two actual members required');
    await grantMedia(accounts.members);
    const source = await openPage(speaker.context, 'camera-failed speaker');
    await installMediaCapture(source, 'camera-failure');
    const peer = await openPage(
      listener.context,
      'hearing isolated microphone',
    );
    await Promise.all([
      source.goto(`/rounds/${round.id}/room`),
      peer.goto(`/rounds/${round.id}/room`),
    ]);
    await expect(
      source
        .getByRole('status')
        .filter({ hasText: /Connected.*Your camera could not start/ }),
    ).toBeVisible(MEDIA_POLL);
    await expect(source.getByLabel('Your camera', { exact: true })).toHaveCount(
      0,
    );
    await peer
      .getByRole('button', { name: 'Enable sound', exact: true })
      .click();
    await expect
      .poll(
        () =>
          peer
            .getByLabel('Participant audio', { exact: true })
            .evaluateAll((nodes) =>
              nodes.some((node) => {
                const audio = node as HTMLAudioElement;
                return (
                  !audio.paused &&
                  audio.readyState >= 2 &&
                  (audio.srcObject as MediaStream | null)
                    ?.getAudioTracks()
                    .some((track) => track.readyState === 'live')
                );
              }),
            ),
        MEDIA_POLL,
      )
      .toBe(true);
    const audibleSignal = await peer
      .getByLabel('Participant audio', { exact: true })
      .first()
      .evaluate(async (node) => {
        const stream = (node as HTMLAudioElement).srcObject as MediaStream;
        const audio = new AudioContext();
        await audio.resume();
        const analyser = audio.createAnalyser();
        audio.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        try {
          return await new Promise<boolean>((resolve) => {
            let frames = 0;
            const sample = () => {
              analyser.getFloatTimeDomainData(samples);
              if (samples.some((value) => Math.abs(value) > 0.01))
                resolve(true);
              else if (++frames > 120) resolve(false);
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
        } finally {
          await audio.close();
        }
      });
    expect(audibleSignal).toBe(true);
    const response = await speaker.context.request.get(
      `/api/rounds/${round.id}/media`,
    );
    expect(response.status()).toBe(200);
    const state = roundMediaStateSchema.parse(await response.json());
    expect(state.grants.publish).toContain('microphone');
    expect(state.grants.subscribe).toBe(true);
    await source.screenshot({
      path: test.info().outputPath('camera-failed-microphone-live.png'),
    });
  } finally {
    await closeSettledLaunchContexts(accounts);
  }
});
