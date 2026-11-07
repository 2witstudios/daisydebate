import { dispose } from '@livekit/rtc-node';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAudioSubscription } from '../src/audio-subscription';
import { createMediaService } from '../src/service';
import { withNativePublication, config } from './native-room.test-support';
import { pcmJob, waitForCadence } from './native-fixtures.test-support';
setupRitewayBun();
requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});
async function until(test: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!test()) {
    if (performance.now() >= deadline)
      throw new Error('Native capture observation deadline');
    await Bun.sleep(10);
  }
}
test('actual16k subscription preserves decoder observations separately from stationary source transport counters', async () => {
  await withNativePublication(async ({ publisher, roomName, identity }) => {
    let binding:
        | { incarnation: string; trackId: string; generation: number }
        | undefined,
      frames = 0,
      valid = true,
      closed = false;
    const service = createMediaService({ config });
    const subscription = await createAudioSubscription({
      url: 'ws://127.0.0.1:7880',
      token: await service.joinToken({
        room: roomName,
        identity: createId(),
        publish: [],
        subscribe: true,
        capture: true,
      }),
      identities: [identity],
      nowMs: () => performance.now(),
      onTrackStarted: (track) => {
        binding = {
          incarnation: track.incarnation,
          trackId: track.trackId,
          generation: track.generation,
        };
      },
      onTrackClosed: () => {
        closed = true;
      },
      onFrame: (frame) => {
        valid =
          valid &&
          frame.subscriptionGeneration === binding?.generation &&
          frame.subscriptionIncarnation === binding?.incarnation &&
          frame.pcm.length === 160 &&
          frame.sequence === frames &&
          frame.afterMs >= frame.beforeMs;
        frames++;
        frame.pcm.fill(0);
      },
    });
    try {
      await until(() => binding !== undefined && frames >= 20);
      const stale = await subscription.transport({
        ...binding!,
        generation: binding!.generation + 1,
      });
      const beforeFrames = frames,
        before = await subscription.transport(binding!);
      const source = pcmJob(),
        start = performance.now(),
        signal = new AbortController().signal;
      for (let i = 0; i < 20; i++) {
        await publisher.capture10ms(source.subarray(i * 480, (i + 1) * 480));
        await waitForCadence(start + (i + 1) * 10, signal);
      }
      const target = frames + 30;
      await until(() => frames >= target);
      const deliveredFrames = frames,
        delivered = await subscription.transport(binding!);
      await until(() => frames >= deliveredFrames + 30);
      const gapFrames = frames,
        gap = await subscription.transport(binding!);
      const outcome = {
        staleBindingUnknown:
          stale.kind === 'unknown' && stale.reason === 'unbound',
        beforeUnknown: before.kind === 'unknown',
        beforeFrames: beforeFrames >= 20,
        observed: delivered.kind === 'observed' && gap.kind === 'observed',
        sameBinding:
          delivered.kind === 'observed' &&
          gap.kind === 'observed' &&
          delivered.binding.trackId === binding?.trackId &&
          gap.binding.generation === delivered.binding.generation,
        positivePackets:
          delivered.kind === 'observed' &&
          BigInt(delivered.counters.packetsReceived) > 0n,
        stationaryPackets:
          delivered.kind === 'observed' &&
          gap.kind === 'observed' &&
          delivered.counters.packetsReceived === gap.counters.packetsReceived,
        decoderSamplesIncrease:
          delivered.kind === 'observed' &&
          gap.kind === 'observed' &&
          BigInt(gap.counters.totalSamplesReceived) >
            BigInt(delivered.counters.totalSamplesReceived),
        callbacksContinue: gapFrames - deliveredFrames >= 30,
        valid,
        closed,
        source: publisher.sentSamples(),
      };
      process.stdout.write(
        JSON.stringify({
          event: 'native.capture.transport16k',
          before: before.kind,
          delivered:
            delivered.kind === 'observed' ? delivered.counters : delivered,
          gap: gap.kind === 'observed' ? gap.counters : gap,
          outcome,
        }) + '\n',
      );
      assert({
        given:
          'the actual production16k AudioFrameProcessor subscription before input and after200ms input stops',
        should:
          'retain callback-order/format observations while exposing stationary packet counters without promoting source completeness/silence/coverage/hearing',
        actual: outcome,
        expected: {
          staleBindingUnknown: true,
          beforeUnknown: true,
          beforeFrames: true,
          observed: true,
          sameBinding: true,
          positivePackets: true,
          stationaryPackets: true,
          decoderSamplesIncrease: true,
          callbacksContinue: true,
          valid: true,
          closed: false,
          source: 9600,
        },
      });
      const next = frames + 30;
      await until(() => frames >= next);
      const pending = subscription.transport(binding!);
      const stopping = subscription.close();
      const late = await pending;
      await stopping;
      assert({
        given:
          'a real bound native request when its owning16k subscription closes',
        should:
          'refuse the pending or later observation through the owning lifecycle',
        actual: { late, after: await subscription.transport(binding!) },
        expected: {
          late: { kind: 'unknown', reason: 'closed' },
          after: { kind: 'unknown', reason: 'closed' },
        },
      });
    } finally {
      await subscription.close();
    }
  });
}, 20000);

test('two subscription objects cannot answer the old binding for one persistent published track', async () => {
  await withNativePublication(async ({ publisher, roomName, identity }) => {
    const service = createMediaService({ config });
    const open = async () => {
      let binding:
          | Parameters<
              Parameters<typeof createAudioSubscription>[0]['onTrackStarted']
            >[0]
          | undefined,
        frames = 0;
      const subscription = await createAudioSubscription({
        url: 'ws://127.0.0.1:7880',
        token: await service.joinToken({
          room: roomName,
          identity: createId(),
          publish: [],
          subscribe: true,
          capture: true,
        }),
        identities: [identity],
        nowMs: () => performance.now(),
        onTrackStarted: (track) => {
          binding = track;
        },
        onTrackClosed: () => undefined,
        onFrame: (frame) => {
          frames++;
          frame.pcm.fill(0);
        },
      });
      await until(() => binding !== undefined && frames >= 20);
      return { subscription, binding: binding!, frames: () => frames };
    };
    const send = async () => {
      const source = pcmJob(),
        start = performance.now(),
        signal = new AbortController().signal;
      for (let i = 0; i < 20; i++) {
        await publisher.capture10ms(source.subarray(i * 480, (i + 1) * 480));
        await waitForCadence(start + (i + 1) * 10, signal);
      }
    };
    const a = await open();
    let b: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await send();
      await a.subscription.close();
      b = await open();
      await send();
      const target = b.frames() + 30;
      await until(() => b!.frames() >= target);
      const old = await b.subscription.transport(a.binding),
        current = await b.subscription.transport(b.binding);
      assert({
        given:
          'the same publisher track surviving subscriber-object replacement with both local generations starting1',
        should:
          'refuse an old lookup routed to the new object while allowing its own current binding',
        actual: {
          differentIncarnations:
            a.binding.incarnation !== b.binding.incarnation,
          sameTrack: a.binding.trackId === b.binding.trackId,
          sameGeneration: a.binding.generation === b.binding.generation,
          old,
          currentObserved: current.kind === 'observed',
        },
        expected: {
          differentIncarnations: true,
          sameTrack: true,
          sameGeneration: true,
          old: { kind: 'unknown', reason: 'unbound' },
          currentObserved: true,
        },
      });
    } finally {
      await a.subscription.close();
      await b?.subscription.close();
    }
  });
}, 20000);
