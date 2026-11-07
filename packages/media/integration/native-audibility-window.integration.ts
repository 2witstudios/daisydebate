import { dispose } from '@livekit/rtc-node';
import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withNativePublication } from './native-room.test-support';
import {
  withHistoricalSeat,
  pcmJob,
  waitForCadence,
} from './native-fixtures.test-support';
import { createPacedAudioWriter } from '../src/paced-publication';
import {
  createNativePublicationEvidence,
  assertNativePublicationEvidence,
} from './publication-evidence.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});
for (const audible of [true, false])
  test(`queued native silence cannot determine whether the subsequent 200ms source is audible=${audible}`, async () => {
    await withHistoricalSeat(databaseUrl, async (history) => {
      await withNativePublication(async ({ publisher, reader, reception }) => {
        // Deliberately retain at least9600 pre-source samples in the reader's queue.
        await reception.waitForPrelude();
        const evidence = createNativePublicationEvidence();
        const result = await createPacedAudioWriter({
          publication: {
            ...publisher,
            capture10ms: (data) => {
              reception.begin();
              return publisher.capture10ms(data);
            },
          },
          sampleRate: 48000,
          channels: 1,
          framesPerAuthorization: 1,
          nowMs: performance.now,
          waitUntilMs: waitForCadence,
          calibrate: history.calibrate,
          refreshAfterMs: 50,
          authorizeWindow: history.authorizeWindow,
          observer: evidence.observer,
        })(
          audible ? pcmJob() : new Int16Array(9600),
          new AbortController().signal,
        );
        assertNativePublicationEvidence(evidence, result, 'complete');
        let prefixSamples = 0,
          prefixEnergy = 0;
        while (prefixSamples < 9600) {
          const frame = await reader.read();
          if (frame.done) break;
          prefixSamples += frame.value.samplesPerChannel;
          prefixEnergy += frame.value.data.reduce(
            (sum, value) => sum + value * value,
            0,
          );
        }
        const received = await reception.read();
        assert({
          given:
            'at least 200ms of real queued native output before a separately paced200ms source job',
          should:
            'keep exact9600 source/window samples and independent actual audibility, ignoring no frames based on their energy',
          actual: {
            prefixSamples,
            prefixSilent: prefixEnergy === 0,
            eligibleSamples: result.eligibleSamples,
            receivedSamples: received.samples,
            // The fixture square wave has amplitude1000; require at least10%
            // phase-independent fundamental amplitude, not codec dither.
            audible: received.energy > 0 && received.toneAmplitude >= 100,
          },
          expected: {
            prefixSamples: 9600,
            prefixSilent: true,
            eligibleSamples: 9600,
            receivedSamples: 9600,
            audible,
          },
        });
      }, history.binding);
    });
  }, 15000);
