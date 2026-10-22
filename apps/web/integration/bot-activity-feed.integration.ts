import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotActivityFeed } from '../src/features/round-bots/activity-feed';
import { createBotSpeaker } from '../src/features/round-bots/speaker';
import { withRoomRuntime } from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);
const frames = (from: number, count: number, startMs: number) =>
  Array.from({ length: count }, (_, i) => ({
    trackId: 'peer-track',
    sequence: from + i,
    pcm: Array<number>(160).fill(16000),
    beforeMs: (from + i) * 10,
    afterMs: (from + i) * 10 + 10,
    serverWindow: {
      before: new Date(startMs + i * 10).toISOString(),
      after: new Date(startMs + i * 10 + 10).toISOString(),
    },
    receivedAt: new Date(startMs + count * 10).toISOString(),
  }));
test('real Redis peer activity with fresh PG time cancels only the active cross-examination phrase', async () => {
  await withRoomRuntime(async (f) => {
    const roundId = createId(),
      bot = createId(),
      peer = createId();
    const scope = {
      roundId,
      roundParticipantId: bot,
      segmentId: createId(),
      agentRunId: createId(),
      serviceId: 'agent-run:fixture',
      publicationEpoch: 1,
    };
    const events: string[] = [];
    let aborted = 0;
    const speaker = createBotSpeaker({
      claim: { scope, token: 'memory-only', segmentType: 'cross_ex' },
      generate: async () => ({ text: 'Question?', phrases: ['Question?'] }),
      synthesize: async (_s, _t, phraseId, text) => ({
        scope,
        token: 'memory-only',
        phraseId,
        text,
        pcm: new Int16Array(240),
        sampleRate: 24000,
        channels: 1,
      }),
      /** Holds playback open until cancelled; native publication is proven separately. */
      publish: (_job, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            aborted++;
            reject(signal.reason);
          }),
        ),
      nextId: createId,
      maxAttempts: 2,
      failed: () => {
        throw Error('unexpected speaking failure');
      },
    });
    const feed = createBotActivityFeed({
      roundId,
      participantId: bot,
      peerParticipantIds: [peer],
      read: f.redis.readBotActivity,
      databaseNow: f.store.databaseNow,
      playing: speaker.playing,
      onEvent: ({ kind }) => {
        events.push(kind);
        speaker.peer(kind);
      },
    });
    const write = async (from: number, count: number) => {
      const now = Date.parse(await f.store.databaseNow());
      await f.redis.writeBotActivity({
        version: 1,
        roundId,
        roundParticipantId: peer,
        frames: frames(from, count, now - count * 10),
      });
    };
    speaker.wake();
    while (!speaker.playing()) await Bun.sleep(1);
    await write(0, 20);
    await feed.poll();
    await feed.poll();
    await write(20, 20);
    await feed.poll();
    assert({
      given:
        'two real Redis batches of sustained loud peer PCM against fresh PG time while the bot plays',
      should:
        'deliver each frame once, emit barge-in and cancel only the active phrase',
      actual: [events, aborted, speaker.playing()],
      expected: [['barge-in'], 1, false],
    });
    await Bun.sleep(300);
    await feed.poll();
    assert({
      given: 'the same batch read after it aged past 250ms of PG time',
      should: 'report unknown rather than silence',
      actual: events.at(-1),
      expected: 'unknown',
    });
    await speaker.stop();
  });
});
