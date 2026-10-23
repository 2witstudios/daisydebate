import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotPublisher } from '../src/features/round-bots/publication';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { mediaDependencies } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('actual bot broker/native publisher sends a phrase in whole frames, padding its tail, without generated text credit', async () => {
  await withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const deps = mediaDependencies(f);
    const media = createRoundMediaOperations(deps);
    try {
      const publish = createBotPublisher({
        store: f.store,
        botToken: media.botToken,
        monotonicNowMs: () => performance.now(),
        waitUntilMs: async (due, signal) => {
          while (!signal.aborted && performance.now() < due)
            await Bun.sleep(Math.max(1, due - performance.now()));
        },
      });
      const result = await publish(
        {
          scope: claim.scope,
          token: claim.token,
          phraseId: createId(),
          text: 'Memory-only phrase',
          pcm: new Int16Array(241),
          sampleRate: 24000,
          channels: 1,
        },
        AbortSignal.timeout(5000),
      );
      assert({
        given: 'actual 241 content samples and native 240-sample frames',
        should:
          'pad the last frame with silence, publish all the content and report the phrase complete (ISSUE-454)',
        actual: [
          result.originalSamples,
          result.transportSamples,
          result.eligibleSamples,
          result.complete,
        ],
        expected: [241, 480, 480, true],
      });
      assert({
        given: 'actual native publication through the bot broker',
        should: 'create no transcript from generated text',
        actual: (
          await f.sql`select id from utterances where round_id=${roundId}`
        ).length,
        expected: 0,
      });
    } finally {
      const [session] =
        await f.sql`select room_name from media_sessions where round_id=${roundId}`;
      if (session && (await deps.media.exists(session.room_name)))
        await deps.media.deleteRoom(session.room_name);
    }
  }, botControlOptions);
});
