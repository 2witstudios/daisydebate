import { createId } from '@paralleldrive/cuid2';
import { createAudioPublication } from '@daisy/media/audio';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotPublisher } from '../src/features/round-bots/publication';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { hearRoundTracks, mediaDependencies } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

/** Publishes one 241-sample phrase on an owned speech claim, then reads its transcript after teardown. */
async function publishOnce(segmentEndsAt?: string) {
  let outcome:
    | {
        readonly result: Awaited<
          ReturnType<
            ReturnType<ReturnType<typeof createBotPublisher>>['publish']
          >
        >;
        readonly transcript: number;
      }
    | undefined;
  // Awaiting the fixture, not resolving inside it, lets its row cleanup finish first.
  await withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const deps = mediaDependencies(f);
    const media = createRoundMediaOperations(deps);
    const capture = hearRoundTracks(
      f,
      deps,
      roundId,
      claim.scope.roundParticipantId,
    );
    const claimed = createBotPublisher({
      store: f.store,
      botToken: media.botToken,
      connect: createAudioPublication,
      heard: capture.heard,
      nextId: createId,
      monotonicNowMs: () => performance.now(),
      waitUntilMs: async (due, signal) => {
        while (!signal.aborted && performance.now() < due)
          await Bun.sleep(Math.max(1, due - performance.now()));
      },
    })(claim);
    try {
      // Joined with the claim, ahead of speech, as the seat does.
      claimed.start();
      const result = await claimed.publish(
        {
          scope: claim.scope,
          token: claim.token,
          phraseId: createId(),
          text: 'Memory-only phrase',
          pcm: new Int16Array(241),
          sampleRate: 24000,
          channels: 1,
          ...(segmentEndsAt ? { segmentEndsAt } : {}),
        },
        AbortSignal.timeout(5000),
      );
      outcome = {
        result,
        transcript: (
          await f.sql`select id from utterances where round_id=${roundId}`
        ).length,
      };
    } finally {
      await claimed.close();
      await capture.close();
      const [session] =
        await f.sql`select room_name from media_sessions where round_id=${roundId}`;
      if (session && (await deps.media.exists(session.room_name)))
        await deps.media.deleteRoom(session.room_name);
    }
  }, botControlOptions);
  return outcome!;
}

test('actual bot broker/native publisher sends a phrase in whole frames, padding its tail, without generated text credit', async () => {
  const { result, transcript } = await publishOnce();
  assert({
    given: 'actual 241 content samples and native 240-sample frames',
    should:
      'pad the last frame with silence, publish all the content and report the phrase complete (ISSUE-454)',
    actual: [
      result.originalSamples,
      result.transportSamples,
      result.eligibleSamples,
      result.complete,
      result.segmentEnded,
    ],
    expected: [241, 480, 480, true, false],
  });
  assert({
    given: 'actual native publication through the bot broker',
    should: 'create no transcript from generated text',
    actual: transcript,
    expected: 0,
  });
});

test('a phrase whose known segment end has passed is not credited', async () => {
  const { result } = await publishOnce(
    new Date(Date.now() - 60_000).toISOString(),
  );
  assert({
    given: 'a phrase carrying a segment end a minute ago',
    should:
      'reach the writer clamp and credit nothing, so the end is wired from job to writer (ISSUE-460-r1)',
    actual: [result.eligibleSamples, result.complete],
    expected: [0, false],
  });
});
