import {
  proveNativeCapture,
  proveCaptureRoomDeletion,
} from './native-capture.test-support';
import {
  withHistoricalSeat,
  waitForCadence,
  pcmJob,
} from './native-fixtures.test-support';
import { createPacedAudioWriter } from '../src/paced-publication';
import { afterAll } from 'bun:test';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { dispose } from '@livekit/rtc-node';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { SourceProgress } from '../src/audio-publication';
import { withNativePublication } from './native-room.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});

test(
  'Bun zero-buffer native publication acknowledges actual 10ms source handoffs',
  () =>
    withNativePublication(async ({ publisher, reader }) => {
      const progress: SourceProgress[] = [];
      for (let index = 0; index < 20; index++) {
        const frame = new Int16Array(480);
        for (let sample = 0; sample < frame.length; sample++)
          frame[sample] = (sample + index * 480) % 80 < 40 ? 1000 : -1000;
        progress.push(await publisher.capture10ms(frame));
      }
      const received = await reader.read();
      assert({
        given: 'twenty acknowledged real zero-buffer native handoffs',
        should:
          'count a contiguous 9600-sample source prefix with monotonic timing brackets',
        actual: {
          start: progress[0]!.startSample,
          end: progress.at(-1)!.endSample,
          bracketed: progress.every(
            (p, index) =>
              p.beforeMs <= p.afterMs &&
              p.endSample - p.startSample === 480 &&
              (index === 0 || p.startSample === progress[index - 1]!.endSample),
          ),
        },
        expected: { start: 0, end: 9600, bracketed: true },
      });
      assert({
        given: 'the independent LiveKit subscriber',
        should: 'receive real 48kHz mono 10ms PCM frames',
        actual: received.done
          ? null
          : {
              rate: received.value.sampleRate,
              channels: received.value.channels,
              samples: received.value.samplesPerChannel,
            },
        expected: { rate: 48000, channels: 1, samples: 480 },
      });
      const inFlight = publisher.capture10ms(new Int16Array(480));
      // A deliberate event-loop stall, not a wait for an expected result: native
      // dispatch/ack occurs while JS is blocked, so its bracket must stay wide.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      const stalled = await inFlight;
      assert({
        given:
          'the real native callback delayed by a deliberate 150ms JS stall',
        should:
          'retain the full uncertainty bracket instead of inventing a playout instant',
        actual: {
          wide: stalled.afterMs - stalled.beforeMs >= 100,
          start: stalled.startSample,
          end: stalled.endSample,
        },
        expected: { wide: true, start: 9600, end: 10080 },
      });
      await assertRejects({
        given: 'a malformed PCM frame',
        should: 'refuse before native publication',
        actual: () => publisher!.capture10ms(new Int16Array(479)),
        code: 'VALIDATION',
      });
      assert({
        given: 'cancellation after acknowledged native handoffs',
        should:
          'report only the consumed contiguous prefix with no native queue remaining',
        actual: await publisher.close(),
        expected: { consumedSamples: 10080 },
      });
      await assertRejects({
        given: 'a frame after cancellation',
        should: 'refuse any later source handoff',
        actual: () => publisher!.capture10ms(new Int16Array(480)),
        code: 'CONFLICT',
      });
    }),
  15000,
);

test(
  'paced native PCM uses the real database clock and historical eligibility for a 200ms job',
  () =>
    withHistoricalSeat(databaseUrl, async (history) => {
      await withNativePublication(async ({ publisher, reader }) => {
        const start = performance.now();
        let calibrations = 0;
        const result = await createPacedAudioWriter({
          publication: publisher,
          sampleRate: 48000,
          channels: 1,
          nowMs: () => performance.now(),
          waitUntilMs: waitForCadence,
          calibrate: async () => {
            calibrations++;
            return history.calibrate();
          },
          refreshAfterMs: 50,
          authorizeWindow: history.authorizeWindow,
        })(pcmJob(), new AbortController().signal);
        let receivedSamples = 0;
        let receivedEnergy = 0;
        while (receivedSamples < 9600) {
          const frame = await reader.read();
          if (frame.done) break;
          receivedSamples += frame.value.samplesPerChannel;
          receivedEnergy += frame.value.data.reduce(
            (sum, sample) => sum + sample * sample,
            0,
          );
        }
        assert({
          given:
            '9600 PCM samples paced in 10ms native frames and authorized by real PostgreSQL history',
          should:
            'credit the complete source prefix only after at least 200ms of actual cadence',
          actual: {
            ...result,
            cadenceElapsed: performance.now() - start >= 200,
            refreshed: calibrations >= 2,
            receivedSamples,
            audible: receivedEnergy > 0,
          },
          expected: {
            eligibleSamples: 9600,
            complete: true,
            cadenceElapsed: true,
            refreshed: true,
            receivedSamples: 9600,
            audible: true,
          },
        });
      }, history.binding);
    }),
  15000,
);

test('burst handoff, stalled callback and revoked history cannot credit queued future PCM', async () => {
  for (const fault of ['burst', 'stall', 'history', 'cancel'] as const) {
    await withHistoricalSeat(databaseUrl, async (history) => {
      await withNativePublication(async ({ publisher }) => {
        const controller = new AbortController();
        const publication =
          fault !== 'stall'
            ? publisher
            : {
                ...publisher,
                capture10ms: (data: Int16Array) => {
                  const dispatched = publisher.capture10ms(data);
                  Atomics.wait(
                    new Int32Array(new SharedArrayBuffer(4)),
                    0,
                    0,
                    150,
                  );
                  return dispatched;
                },
              };
        const write = createPacedAudioWriter({
          publication,
          sampleRate: 48000,
          channels: 1,
          nowMs: () => performance.now(),
          waitUntilMs: fault === 'burst' ? async () => {} : waitForCadence,
          calibrate: history.calibrate,
          authorizeWindow: history.authorizeWindow,
          onAccepted: async (samples) => {
            if (samples === 1440 && fault === 'history')
              await history.closeEligibility();
            if (samples === 1440 && fault === 'cancel') controller.abort();
          },
        });
        const result = await write(pcmJob(), controller.signal);
        const raw = await publisher.close();
        assert({
          given: `a real native ${fault} fault during publication`,
          should:
            'retain only the authorized paced prefix and stop future source dispatch',
          actual: { ...result, rawSamples: raw.consumedSamples },
          expected: {
            eligibleSamples: fault === 'burst' || fault === 'stall' ? 0 : 1440,
            complete: false,
            rawSamples:
              fault === 'burst' || fault === 'stall'
                ? 480
                : fault === 'cancel'
                  ? 1440
                  : 1920,
          },
        });
      }, history.binding);
    });
  }
}, 30000);

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
