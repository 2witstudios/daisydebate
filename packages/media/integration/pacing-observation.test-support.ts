import { once } from 'node:events';
import { AudioStream, Room, RoomEvent, Track } from '@livekit/rtc-node';
import { createId } from '@paralleldrive/cuid2';
import { createMediaService } from '../src/service';
import { createAudioPublication } from '../src/audio-publication';
import { createStreamingAudioWriter } from '../src/audio-stream';

/** Synthetic local-only observation; raw PCM is needed for codec-aware alignment. */
export async function observeNativePacing(input: {
  readonly phase: 'on-time' | 'initial-fill' | 'established-lead';
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  const config = {
    url: 'http://127.0.0.1:7880',
    apiKey: 'daisy-local',
    apiSecret: 'local-development-only-livekit-secret',
  };
  const service = createMediaService({ config });
  const roomName = createId();
  const subscriber = new Room();
  const controller = new AbortController();
  const trace: {
    event: string;
    frame: number;
    due: number;
    at: number;
    queuedMs: number;
  }[] = [];
  const received: { at: number; offset: number; samples: number }[] = [];
  const chunks: Int16Array[] = [];
  // Deterministic broadband signal: unlike a tone/chirp, a local window
  // identifies source position without whole-cycle alignment ambiguity.
  let noiseState = 123456789;
  let filtered = 0;
  const pcm = Int16Array.from({ length: 36000 }, () => {
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) >>> 0;
    filtered =
      filtered * 0.6 + ((noiseState / 4294967296) * 2 - 1) * 10000 * 0.4;
    return Math.round(filtered);
  });
  let receivedSamples = 0;
  await service.createRoom(roomName);
  let publisher: Awaited<ReturnType<typeof createAudioPublication>> | undefined;
  try {
    await subscriber.connect(
      'ws://127.0.0.1:7880',
      await service.joinToken({
        room: roomName,
        identity: createId(),
        publish: [],
        subscribe: true,
        capture: true,
      }),
    );
    const subscribed = once(subscriber, RoomEvent.TrackSubscribed, {
      signal: AbortSignal.timeout(5000),
    });
    publisher = await createAudioPublication({
      url: 'ws://127.0.0.1:7880',
      token: await service.joinToken({
        room: roomName,
        identity: createId(),
        publish: ['microphone'],
        subscribe: false,
        capture: false,
      }),
      trackName: createId(),
      sampleRate: 24000,
      channels: 1,
      queueMs: 500,
    });
    const [track] = await subscribed;
    if (!(track instanceof Track)) throw new Error('Missing subscribed track');
    const stream = new AudioStream(track, {
      sampleRate: 24000,
      numChannels: 1,
      frameSizeMs: 10,
    });
    const reader = stream.getReader();
    const reading = (async () => {
      for (;;) {
        const next = await reader.read();
        if (next.done) return;
        const data = new Int16Array(next.value.data);
        received.push({
          at: performance.now(),
          offset: receivedSamples,
          samples: data.length,
        });
        receivedSamples += data.length;
        chunks.push(data);
      }
    })();
    try {
      const target = publisher;
      let frame = 0;
      const start = performance.now();
      let delayed = false;
      let origin = Number.NaN;
      const stamp = (event: string, due: number) =>
        trace.push({
          event,
          frame,
          due,
          at: performance.now(),
          queuedMs: target.queuedMs(),
        });
      const write = createStreamingAudioWriter({
        target: {
          queuedMs: target.queuedMs,
          clearQueue: target.clearQueue,
          capture10ms: async (data) => {
            const due = origin + frame * 10 - 300;
            stamp('capture-entry', due);
            await target.capture10ms(data);
            stamp('capture-settle', due);
            if (input.phase === 'initial-fill' && frame === 6) {
              stamp('continuation-delay-entry', due);
              await input.waitUntilMs(
                performance.now() + 86.025459,
                controller.signal,
              );
              stamp('continuation-delay-return', due);
              delayed = true;
            }
            frame += 1;
          },
        },
        sampleRate: 24000,
        channels: 1,
        leadMs: 300,
        nowMs: () => {
          const now = performance.now();
          if (!Number.isFinite(origin)) origin = now + target.queuedMs();
          return now;
        },
        waitUntilMs: async (due, signal) => {
          stamp('wait-entry', due);
          await input.waitUntilMs(due, signal);
          if (input.phase === 'established-lead' && !delayed && frame >= 37) {
            stamp('continuation-delay-entry', due);
            await input.waitUntilMs(due + 79.635583, signal);
            stamp('continuation-delay-return', due);
            delayed = true;
          }
          stamp('wait-return', due);
        },
      });
      const result = await write(pcm, controller.signal);
      stamp('writer-return', start + 1500);
      while (target.queuedMs() > 0)
        await input.waitUntilMs(
          performance.now() + target.queuedMs(),
          controller.signal,
        );
      stamp('queue-drained', start + 1500);
      // Deliberate capture tail; excluded from in-speech continuity analysis.
      await input.waitUntilMs(performance.now() + 250, controller.signal);
      const output = new Int16Array(receivedSamples);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
      }
      const codecs = (await track.getStats({ timeoutMs: 2000 })).flatMap(
        (stat) =>
          stat.stats.case === 'codec'
            ? [
                {
                  mimeType: stat.stats.value.codec?.mimeType,
                  clockRate: stat.stats.value.codec?.clockRate,
                  channels: stat.stats.value.codec?.channels,
                },
              ]
            : [],
      );
      return {
        codecs,
        phase: input.phase,
        start,
        result,
        delayed,
        trace,
        received,
        source: pcm,
        pcm: output,
      };
    } finally {
      controller.abort();
      await reader.cancel();
      await reading;
      reader.releaseLock();
    }
  } finally {
    await publisher?.close();
    await subscriber.disconnect();
    if (await service.exists(roomName)) await service.deleteRoom(roomName);
  }
}
