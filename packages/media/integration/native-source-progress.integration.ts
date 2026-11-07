import { AudioStream, dispose, type Room } from '@livekit/rtc-node';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withNativePublication } from './native-room.test-support';
import { NativeCallbackCount } from './native-callback-count.test-support';
import {
  withHistoricalSeat,
  pcmJob,
  waitForCadence,
} from './native-fixtures.test-support';
import { createPacedAudioWriter } from '../src/paced-publication';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});
const inbound = (
  stats: Awaited<ReturnType<Room['getRtcStats']>>,
  trackId: string | undefined,
  trackName: string | undefined,
  participantSid: string | undefined,
) => ({
  publisherRecords: stats.publisherStats.length,
  subscriberRecords: stats.subscriberStats.length,
  subscriberKinds: [
    ...new Set(stats.subscriberStats.map((row) => row.stats.case ?? 'unknown')),
  ],
  inbound:
    [
      ...stats.publisherStats.map((row) => ({ collection: 'publisher', row })),
      ...stats.subscriberStats.map((row) => ({
        collection: 'subscriber',
        row,
      })),
    ].flatMap(({ collection, row }) => {
      if (row.stats.case !== 'inboundRtp') return [];
      const { stream, received, inbound: audio } = row.stats.value;
      return [
        {
          collection,
          kind: stream?.kind ?? null,
          trackMatch:
            audio?.trackIdentifier === undefined
              ? null
              : audio.trackIdentifier === trackId,
          trackNameMatch:
            audio?.trackIdentifier === undefined || trackName === undefined
              ? null
              : audio.trackIdentifier === trackName,
          containsTrackSid:
            audio?.trackIdentifier === undefined || trackId === undefined
              ? null
              : audio.trackIdentifier.includes(trackId),
          compositeMatch:
            audio?.trackIdentifier === undefined ||
            trackId === undefined ||
            participantSid === undefined
              ? null
              : audio.trackIdentifier === `${participantSid}|${trackId}`,
          identifierLength: audio?.trackIdentifier?.length ?? null,
          identifierIsUuid:
            audio?.trackIdentifier === undefined
              ? null
              : /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
                  audio.trackIdentifier,
                ),
          packetsReceived: received?.packetsReceived?.toString() ?? null,
          packetsLost: received?.packetsLost?.toString() ?? null,
          totalSamplesReceived: audio?.totalSamplesReceived?.toString() ?? null,
          concealedSamples: audio?.concealedSamples?.toString() ?? null,
          silentConcealedSamples:
            audio?.silentConcealedSamples?.toString() ?? null,
          concealmentEvents: audio?.concealmentEvents?.toString() ?? null,
        },
      ];
    }) + '\n',
});
test('held source input cannot be replaced by continuing decoder callbacks or received-sample totals', async () => {
  await withHistoricalSeat(databaseUrl, async (history) => {
    await withNativePublication(
      async ({ publisher, track, getStats, remoteParticipantSid }) => {
        const callbacks = new NativeCallbackCount();
        const observation = new AudioStream(track, {
          sampleRate: 48000,
          numChannels: 1,
          frameSizeMs: 10,
          noiseCancellation: callbacks,
        });
        const reader = observation.getReader(),
          entered = Promise.withResolvers<void>(),
          release = Promise.withResolvers<void>(),
          abort = new AbortController();
        let held = false;
        let writing:
          ReturnType<ReturnType<typeof createPacedAudioWriter>> | undefined;
        const snapshot = async () => ({
          callbacks: callbacks.count,
          handed: publisher.sentSamples(),
          inbound: inbound(
            await getStats(),
            track.sid,
            track.name,
            remoteParticipantSid,
          ),
        });
        try {
          await callbacks.next(20);
          const before = await snapshot();
          const job = new Int16Array(28800);
          for (let offset = 0; offset < job.length; offset += 9600)
            job.set(pcmJob(), offset);
          writing = createPacedAudioWriter({
            publication: {
              ...publisher,
              capture10ms: async (data) => {
                if (publisher.sentSamples() >= 9600) {
                  held = true;
                  entered.resolve();
                  await release.promise;
                }
                if (abort.signal.aborted)
                  throw new Error('Controlled source input outage');
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
          })(job, abort.signal);
          await Promise.race([entered.promise, writing]);
          if (!held) throw new Error('Source never reached controlled outage');
          await callbacks.next(20);
          const delivered = await snapshot();
          await callbacks.next(20);
          const gap = await snapshot();
          abort.abort();
          release.resolve();
          const result = await writing;
          process.stdout.write(
            JSON.stringify({
              event: 'native.sourceProgress.heldInput',
              before,
              delivered,
              gap,
            }) + '\n',
          );
          assert({
            given:
              'a planned600ms source held after200ms while its subscribed decoder continues',
            should:
              'preserve only the actual source prefix, cancel before any later handoff and keep callback progress separate from original source/coverage',
            actual: {
              prelude: before.callbacks >= 20,
              beforeSource: before.handed,
              source: result.eligibleSamples,
              complete: result.complete,
              deliveredSource: delivered.handed,
              gapSource: gap.handed,
              finalSource: publisher.sentSamples(),
              gapCallbacks: gap.callbacks - delivered.callbacks >= 20,
            },
            expected: {
              prelude: true,
              beforeSource: 0,
              source: 9600,
              complete: false,
              deliveredSource: 9600,
              gapSource: 9600,
              finalSource: 9600,
              gapCallbacks: true,
            },
          });
        } finally {
          abort.abort();
          release.resolve();
          await writing;
          await reader.cancel();
          reader.releaseLock();
        }
      },
      history.binding,
    );
  });
}, 15000);
