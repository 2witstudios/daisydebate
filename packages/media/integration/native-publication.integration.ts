import {
  proveNativeCapture,
  proveCalibratedCapture,
  proveCaptureRoomDeletion,
} from './audio-subscription.test-support';
import {
  withHistoricalSeat,
  waitForCadence,
  pcmJob,
} from './native-fixtures.test-support';
import { createStreamingAudioWriter } from '../src/audio-stream';
import { afterAll } from 'bun:test';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { dispose } from '@livekit/rtc-node';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withNativePublication } from './native-room.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});
const writer = (
  publisher: Parameters<typeof createStreamingAudioWriter>[0]['target'],
) =>
  createStreamingAudioWriter({
    target: publisher,
    sampleRate: 48000,
    channels: 1,
    nowMs: () => performance.now(),
    waitUntilMs: waitForCadence,
    leadMs: 100,
  });

test(
  'buffered native publication streams a whole job in real time to a real subscriber (ADR 0122)',
  () =>
    withNativePublication(
      async ({ publisher, reception }) => {
        reception.begin();
        const start = performance.now();
        // A concurrent stall the stream never awaits, as a slow database call would be.
        const stall = Bun.sleep(200);
        const result = await writer({
          ...publisher,
          capture10ms: (data) => publisher.capture10ms(data),
        })(pcmJob(), new AbortController().signal);
        const elapsed = performance.now() - start;
        await stall;
        const received = await reception.read();
        assert({
          given: '200 ms of PCM streamed through the buffered source',
          should:
            'hand every frame over in real time less the lead, and the subscriber should hear all of it',
          actual: {
            ...result,
            paced: elapsed >= 90 && elapsed < 400,
            receivedSamples: received.samples,
            audible: received.energy > 0,
            sourceTone: received.toneAmplitude >= 100,
          },
          expected: {
            sentSamples: 9600,
            playedSamples: 9600,
            aborted: false,
            cut: false,
            paced: true,
            receivedSamples: 9600,
            audible: true,
            sourceTone: true,
          },
        });
        await assertRejects({
          given: 'a malformed PCM frame',
          should: 'refuse before native publication',
          actual: () => publisher.capture10ms(new Int16Array(479)),
          code: 'VALIDATION',
        });
        assert({
          given: 'a close after the stream',
          should: 'report every sample handed over',
          actual: await publisher.close(),
          expected: { consumedSamples: 9600 },
        });
        await assertRejects({
          given: 'a frame after close',
          should: 'refuse any later source handoff',
          actual: () => publisher.capture10ms(new Int16Array(480)),
          code: 'CONFLICT',
        });
      },
      undefined,
      500,
    ),
  15000,
);

test(
  'an abort clears the native queue and counts only the audio that played (AMEND-1)',
  () =>
    withNativePublication(
      async ({ publisher }) => {
        const controller = new AbortController();
        const long = new Int16Array(48000);
        long.fill(1000);
        const writing = writer(publisher)(long, controller.signal);
        await Bun.sleep(300);
        controller.abort();
        const result = await writing;
        assert({
          given:
            'a one-second job aborted after about 300 ms with a 100 ms lead',
          should:
            'stop at once, clear the queue, and count as played less than was sent',
          actual: {
            aborted: result.aborted,
            queued: publisher.queuedMs(),
            playedBelowSent: result.playedSamples < result.sentSamples,
            playedNearAbort:
              result.playedSamples >= 48000 * 0.2 &&
              result.playedSamples <= 48000 * 0.4,
          },
          expected: {
            aborted: true,
            queued: 0,
            playedBelowSent: true,
            playedNearAbort: true,
          },
        });
      },
      undefined,
      500,
    ),
  15000,
);

test(
  'real hidden capture receives callback-stamped 16k mono PCM and closes unpublished streams',
  () => withNativePublication(proveNativeCapture),
  15000,
);

test(
  'deleted room disconnects real hidden capture and ends every microphone stream',
  () => withNativePublication(proveCaptureRoomDeletion),
  15000,
);

test(
  'actual 16k callback cadence retains calibrated historical PCM without source-time claims',
  () => withHistoricalSeat(databaseUrl, proveCalibratedCapture),
  20000,
);
