import { AudioStream, dispose, type Track } from '@livekit/rtc-node';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withNativePublication, config } from './native-room.test-support';
import { createMediaService } from '../src/service';
import { createAudioPublication } from '../src/audio-publication';
import { createId } from '@paralleldrive/cuid2';
import { NativeCallbackCount } from './native-callback-count.test-support';
import { pcmJob, waitForCadence } from './native-fixtures.test-support';
setupRitewayBun();
requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});
const summary = (stats: Awaited<ReturnType<Track['getStats']>>) =>
  stats.flatMap((row) => {
    if (row.stats.case !== 'inboundRtp') return [];
    const value = row.stats.value;
    return [
      {
        kind: value.stream?.kind ?? null,
        packets: value.received?.packetsReceived?.toString() ?? null,
        lost: value.received?.packetsLost?.toString() ?? null,
        samples: value.inbound?.totalSamplesReceived?.toString() ?? null,
        concealed: value.inbound?.concealedSamples?.toString() ?? null,
      },
    ];
  });
const errorCode = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  typeof error.code === 'string' &&
  /^TRACK_STATS_[A-Z_]+$/.test(error.code)
    ? error.code
    : 'UNEXPECTED_ERROR';
test('actual subscribed trackHandle stats request responds under its bounded SDK deadline', async () => {
  await withNativePublication(async ({ publisher, track }) => {
    const counter = new NativeCallbackCount();
    const stream = new AudioStream(track, {
      sampleRate: 48000,
      numChannels: 1,
      frameSizeMs: 10,
      noiseCancellation: counter,
    });
    const reader = stream.getReader();
    try {
      await counter.next(20);
      const before = summary(await track.getStats({ timeoutMs: 1000 }));
      const source = pcmJob(),
        start = performance.now(),
        signal = new AbortController().signal;
      for (let frame = 0; frame < 20; frame++) {
        await publisher.capture10ms(
          source.subarray(frame * 480, (frame + 1) * 480),
        );
        await waitForCadence(start + (frame + 1) * 10, signal);
      }
      await counter.next(20);
      const at = performance.now(),
        rows = await track.getStats({ timeoutMs: 1000 });
      const after = summary(rows);
      process.stdout.write(
        JSON.stringify({
          event: 'native.trackStats.actual',
          outcome: 'returned',
          before,
          after,
          requestMs: performance.now() - at,
        }) + '\n',
      );
      assert({
        given:
          'the actual subscribed RemoteTrack and 200ms of controlled native input',
        should:
          'execute the existing native trackHandle request and return bounded metadata, without claiming source coverage or multi-track binding yet',
        actual: {
          source: publisher.sentSamples(),
          records: after.length,
          received: after.some(
            (row) => row.packets !== null && BigInt(row.packets) > 0n,
          ),
        },
        expected: { source: 9600, records: 1, received: true },
      });
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          event: 'native.trackStats.actual',
          outcome: 'error',
          code: errorCode(error),
        }) + '\n',
      );
      throw error;
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  });
}, 15000);

for (const control of ['pre-abort', 'abort', 'deadline', 'close'] as const)
  test(`actual track stats ${control} refuses stale results and cleans its binding`, async () => {
    await withNativePublication(async ({ track }) => {
      const abort = new AbortController();
      if (control === 'pre-abort') abort.abort();
      const started = performance.now();
      const pending = track.getStats({
        signal: abort.signal,
        timeoutMs: control === 'deadline' ? 5 : 1000,
      });
      if (control === 'abort') abort.abort();
      if (control === 'deadline') {
        // Actual native request was issued; delay JS delivery past its freshness bound.
        while (performance.now() - started < 30) {
          /* controlled event-loop stall */
        }
      }
      if (control === 'close') await track.close();
      const code = await pending.then(() => 'RETURNED', errorCode);
      const repeat = await track
        .getStats({ timeoutMs: 1000 })
        .then(() => 'RETURNED', errorCode);
      process.stdout.write(
        JSON.stringify({
          event: 'native.trackStats.lifecycle',
          control,
          code,
          repeat,
          elapsedMs: performance.now() - started,
        }) + '\n',
      );
      assert({
        given: `an actual subscribed native track with ${control}`,
        should:
          'refuse stale data, preserve pre-dispatch cancellation and require rebind after uncertain dispatch or closure',
        actual: { code, repeat },
        expected: {
          code:
            control === 'deadline'
              ? 'TRACK_STATS_DEADLINE'
              : control === 'close'
                ? 'TRACK_STATS_CLOSED'
                : 'TRACK_STATS_CANCELLED',
          repeat:
            control === 'pre-abort'
              ? 'RETURNED'
              : control === 'close'
                ? 'TRACK_STATS_CLOSED'
                : 'TRACK_STATS_REBIND',
        },
      });
    });
  }, 15000);

async function sendFixtureFrames(
  publication: Awaited<ReturnType<typeof createAudioPublication>>,
  count: number,
) {
  const source = pcmJob(),
    start = performance.now(),
    signal = new AbortController().signal;
  for (let frame = 0; frame < count; frame++) {
    const offset = (frame % 20) * 480;
    await publication.capture10ms(source.subarray(offset, offset + 480));
    await waitForCadence(start + (frame + 1) * 10, signal);
  }
}
const rtpRows = (stats: Awaited<ReturnType<Track['getStats']>>) =>
  stats.flatMap((row) =>
    row.stats.case === 'inboundRtp' ? [row.stats.value] : [],
  );
test('two same-name native tracks return distinct handle-bound RTP records without room-wide identity guessing', async () => {
  await withNativePublication(
    async ({ publisher, track, roomName, waitForTrack }) => {
      if (!track.name || !track.sid)
        throw new Error('Missing original track identity');
      const service = createMediaService({ config }),
        next = waitForTrack();
      void next.catch(() => undefined);
      let other: Awaited<ReturnType<typeof createAudioPublication>> | undefined;
      let reader: ReturnType<AudioStream['getReader']> | undefined;
      try {
        other = await createAudioPublication({
          url: 'ws://127.0.0.1:7880',
          token: await service.joinToken({
            room: roomName,
            identity: createId(),
            publish: ['microphone'],
            subscribe: false,
            capture: false,
          }),
          trackName: track.name,
          sampleRate: 48000,
          channels: 1,
          monotonicNowMs: performance.now,
        });
        const second = await next;
        if (second.sid !== other.trackSid || second.sid === track.sid)
          throw new Error('Wrong second subscribed track');
        const callbacks = new NativeCallbackCount();
        reader = new AudioStream(second, {
          sampleRate: 48000,
          numChannels: 1,
          frameSizeMs: 10,
          noiseCancellation: callbacks,
        }).getReader();
        await sendFixtureFrames(publisher, 20);
        await callbacks.next(20);
        const first = rtpRows(await track.getStats({ timeoutMs: 1000 }));
        const beforeSecond = rtpRows(
          await second.getStats({ timeoutMs: 1000 }),
        );
        await sendFixtureFrames(other, 40);
        await callbacks.next(20);
        const [a, b] = await Promise.all([
          track.getStats({ timeoutMs: 1000 }),
          second.getStats({ timeoutMs: 1000 }),
        ]);
        const left = rtpRows(a),
          right = rtpRows(b),
          l = left[0],
          r = right[0];
        const outcome = {
          originalObjects: track !== second && track.name === second.name,
          oneEach:
            first.length === 1 && left.length === 1 && right.length === 1,
          distinctRtp:
            l?.stream?.ssrc !== undefined &&
            r?.stream?.ssrc !== undefined &&
            l.stream.ssrc !== r.stream.ssrc,
          distinctIdentifiers: Boolean(
            l?.inbound?.trackIdentifier &&
            r?.inbound?.trackIdentifier &&
            l.inbound.trackIdentifier !== r.inbound.trackIdentifier,
          ),
          firstStable:
            first[0]?.received?.packetsReceived !== undefined &&
            l?.received?.packetsReceived === first[0].received.packetsReceived,
          secondPositive:
            typeof r?.received?.packetsReceived === 'bigint' &&
            r.received.packetsReceived > 0n,
          sources: [publisher.sentSamples(), other.sentSamples()],
        };
        process.stdout.write(
          JSON.stringify({
            event: 'native.trackStats.twoTracks',
            beforeSecondRecords: beforeSecond.length,
            left: summary(a),
            right: summary(b),
            outcome,
          }) + '\n',
        );
        assert({
          given:
            'two actual subscribed audio tracks with identical names and independent source inputs, queried concurrently',
          should:
            'return distinct per-handle RTP records and keep first source counters stable while the second source runs',
          actual: outcome,
          expected: {
            originalObjects: true,
            oneEach: true,
            distinctRtp: true,
            distinctIdentifiers: true,
            firstStable: true,
            secondPositive: true,
            sources: [9600, 19200],
          },
        });
      } catch (error) {
        process.stdout.write(
          JSON.stringify({
            event: 'native.trackStats.twoTracks',
            outcome: 'error',
            code: errorCode(error),
          }) + '\n',
        );
        throw error;
      } finally {
        if (reader) {
          await reader.cancel();
          reader.releaseLock();
        }
        await other?.close();
      }
    },
  );
}, 15000);
