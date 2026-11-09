import { createId } from '@paralleldrive/cuid2';
import { createAudioPublication } from '@daisy/media/audio';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBotPublisher } from '../src/features/round-bots/publication';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { mediaDependencies } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

const TEXT = 'The affirmative has not shown any harm at all.';
/**
 * Publishes one phrase on an owned speech claim through the real broker,
 * native publication and database, with its hard stop `stopInMs` away, then
 * reads what was authored.
 */
async function publishOnce(stopInMs: number | 'deadline') {
  let outcome:
    | {
        readonly result: Awaited<
          ReturnType<
            ReturnType<ReturnType<typeof createBotPublisher>>['publish']
          >
        >;
        readonly lines: readonly {
          text: string;
          complete: boolean;
          interrupted: boolean;
          bot_phrase_id: string | null;
        }[];
        readonly streams: readonly { state: string }[];
      }
    | undefined;
  // Awaiting the fixture, not resolving inside it, lets its row cleanup finish first.
  await withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const media = createRoundMediaOperations(mediaDependencies(f));
    const claimed = createBotPublisher({
      store: f.store,
      botToken: media.botToken,
      connect: createAudioPublication,
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
      const stopAtMs =
        stopInMs === 'deadline'
          ? await claimed.deadline()
          : performance.now() + stopInMs;
      const phraseId = createId();
      const result = await claimed.publish(
        {
          scope: claim.scope,
          token: claim.token,
          phraseId,
          text: TEXT,
          // 241 samples: the tail frame is padded with silence (ISSUE-454).
          pcm: new Int16Array(241).fill(500),
          sampleRate: 24000,
          channels: 1,
        },
        AbortSignal.timeout(5000),
        stopAtMs,
      );
      // Its line closes once its queued tail has played, beside any next phrase.
      await Bun.sleep(400);
      await claimed.close();
      outcome = {
        result,
        lines:
          await f.sql`select text,complete,interrupted,bot_phrase_id from utterances where round_id=${roundId}`,
        streams:
          await f.sql`select state from transcript_segments where round_id=${roundId} and round_participant_id=${claim.scope.roundParticipantId}`,
      };
    } finally {
      await claimed.close();
    }
  }, botControlOptions);
  return outcome!;
}

test('a bot phrase plays through the real broker and native track and authors its exact text (ADR 0122)', async () => {
  const { result, lines, streams } = await publishOnce('deadline');
  assert({
    given: 'one phrase published on a live speech claim',
    should:
      'play it whole and author one complete line with exactly its text, its stream complete by construction',
    actual: {
      result,
      lines: lines.map(({ text, complete, interrupted }) => ({
        text,
        complete,
        interrupted,
      })),
      keyed: lines.every((line) => line.bot_phrase_id !== null),
      streams: streams.map((row) => row.state),
    },
    expected: {
      result: { complete: true, segmentEnded: false },
      lines: [{ text: TEXT, complete: true, interrupted: false }],
      keyed: true,
      streams: ['complete'],
    },
  });
});

test('a phrase that cannot finish before its hard stop is never started or credited', async () => {
  const { result, lines } = await publishOnce(5);
  assert({
    given: 'a 20 ms phrase with 5 ms left before the hard stop',
    should: 'start nothing and author no line',
    actual: { result, lines: lines.length },
    expected: { result: { complete: false, segmentEnded: true }, lines: 0 },
  });
});
