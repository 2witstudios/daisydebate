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
test('actual bot broker/native publisher admits only a whole-frame content prefix without generated text credit', async () => {
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
        given: 'actual 241 content samples and native240-sample frames',
        should:
          'publish only the whole10ms prefix and report partial original content',
        actual: [
          result.originalSamples,
          result.transportSamples,
          result.eligibleSamples,
          result.complete,
        ],
        expected: [241, 240, 240, false],
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
