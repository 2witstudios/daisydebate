import { dispose } from '@livekit/rtc-node';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { createAudioSubscription } from '../src/audio-subscription';
import { createMediaService } from '../src/service';
import { config } from './native-room.test-support';
import { pcmJob, waitForCadence } from './native-fixtures.test-support';
import { withDtxSource } from './native-dtx.test-support';
setupRitewayBun();
requireTestServices(process.env);
afterAll(async () => {
  await dispose();
});
async function until(test: () => boolean) {
  const end = performance.now() + 5000;
  while (!test()) {
    if (performance.now() >= end) throw new Error('DTX observation deadline');
    await Bun.sleep(10);
  }
}
test('actual DTX-requested zero source continues capture callbacks with sparse packet progress', async () => {
  await withDtxSource(async (source) => {
    let binding:
        | { incarnation: string; trackId: string; generation: number }
        | undefined,
      frames = 0,
      valid = true;
    const service = createMediaService({ config });
    const sub = await createAudioSubscription({
      url: 'ws://127.0.0.1:7880',
      token: await service.joinToken({
        room: source.roomName,
        identity: createId(),
        publish: [],
        subscribe: true,
        capture: true,
      }),
      identities: [source.identity],
      nowMs: () => performance.now(),
      onTrackStarted: (value) => {
        binding = {
          incarnation: value.incarnation,
          trackId: value.trackId,
          generation: value.generation,
        };
      },
      onTrackClosed: () => undefined,
      onFrame: (frame) => {
        valid =
          valid &&
          frame.pcm.length === 160 &&
          frame.subscriptionGeneration === binding?.generation;
        frames++;
        frame.pcm.fill(0);
      },
    });
    const send = async (count: number, zero: boolean) => {
      const tone = pcmJob(),
        silence = new Int16Array(480),
        start = performance.now(),
        signal = new AbortController().signal;
      for (let i = 0; i < count; i++) {
        await source.send(
          zero ? silence : tone.subarray((i % 20) * 480, ((i % 20) + 1) * 480),
        );
        await waitForCadence(start + (i + 1) * 10, signal);
      }
    };
    try {
      await until(() => binding !== undefined && frames >= 20);
      await send(100, false);
      const tone = await sub.transport(binding!),
        toneFrames = frames;
      await send(300, true);
      const quiet = await sub.transport(binding!),
        quietFrames = frames;
      await until(() => frames >= quietFrames + 30);
      const held = await sub.transport(binding!),
        heldFrames = frames;
      await until(() => frames >= heldFrames + 30);
      const gap = await sub.transport(binding!);
      const observed =
        tone.kind === 'observed' &&
        quiet.kind === 'observed' &&
        held.kind === 'observed' &&
        gap.kind === 'observed';
      const tonePackets =
        tone.kind === 'observed' ? BigInt(tone.counters.packetsReceived) : null;
      const quietPackets =
        quiet.kind === 'observed'
          ? BigInt(quiet.counters.packetsReceived)
          : null;
      const outcome = {
        observed,
        valid,
        sourceSamples: source.sent(),
        zeroSourceCallbacks: quietFrames - toneFrames >= 250,
        sparseZeroPackets:
          tonePackets !== null &&
          quietPackets !== null &&
          quietPackets >= tonePackets &&
          quietPackets - tonePackets < 30n,
        withheldPacketsStationary:
          held.kind === 'observed' &&
          gap.kind === 'observed' &&
          held.counters.packetsReceived === gap.counters.packetsReceived,
        withheldCallbacks: frames - heldFrames >= 30,
      };
      process.stdout.write(
        JSON.stringify({
          event: 'native.capture.dtxRequested',
          tone: tone.kind === 'observed' ? tone.counters : tone,
          zero: quiet.kind === 'observed' ? quiet.counters : quiet,
          held: held.kind === 'observed' ? held.counters : held,
          gap: gap.kind === 'observed' ? gap.counters : gap,
          outcome,
        }) + '\n',
      );
      assert({
        given:
          'native DTX explicitly requested, one second known tone, three seconds continuous known-zero source, then source withheld',
        should:
          'demonstrate sparse packet progress during a healthy synthetic source and continuing decoder callbacks during both cases without calling either human silence or complete coverage',
        actual: outcome,
        expected: {
          observed: true,
          valid: true,
          sourceSamples: 192000,
          zeroSourceCallbacks: true,
          sparseZeroPackets: true,
          withheldPacketsStationary: true,
          withheldCallbacks: true,
        },
      });
    } finally {
      await sub.close();
    }
  });
}, 20000);
