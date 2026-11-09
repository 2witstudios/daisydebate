import { once } from 'node:events';
import { createId } from '@paralleldrive/cuid2';
import { AudioStream, Room, RoomEvent, Track } from '@livekit/rtc-node';
import { createMediaService } from '../src/service';
import { createAudioPublication } from '../src/audio-publication';
import { NativeReception } from './native-reception.test-support';

export const config = {
  url: 'http://127.0.0.1:7880',
  apiKey: 'daisy-local',
  apiSecret: 'local-development-only-livekit-secret',
};

type NativePublication = Awaited<ReturnType<typeof createAudioPublication>>;
async function closeFixturePublisher(
  publisher: NativePublication | undefined,
  service: ReturnType<typeof createMediaService>,
  roomName: string,
) {
  try {
    await publisher?.close();
  } catch (error) {
    // An externally deleted room can reject the fixture's now-unnecessary
    // unpublish. Only independently verified room absence discharges it.
    if (await service.exists(roomName)) throw error;
  }
}

export async function withNativePublication(
  work: (input: {
    publisher: NativePublication;
    roomName: string;
    identity: string;
    track: Track;
    reception: NativeReception;
    getStats: () => ReturnType<Room['getRtcStats']>;
    remoteParticipantSid: string | undefined;
    waitForTrack: () => Promise<Track>;
    reader: import('node:stream/web').ReadableStreamDefaultReader<
      import('@livekit/rtc-node').AudioFrame
    >;
  }) => Promise<void>,
  binding?: { roomName: string; identity: string },
) {
  const service = createMediaService({ config });
  const roomName = binding?.roomName ?? createId();
  const identity = binding?.identity ?? createId();
  const subscriber = new Room();
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
        identity,
        publish: ['microphone'],
        subscribe: false,
        capture: false,
      }),
      trackName: createId(),
      sampleRate: 48000,
      channels: 1,
    });
    const [track, , participant] = await subscribed;
    const reception = new NativeReception();
    const stream = new AudioStream(track, {
      sampleRate: 48000,
      numChannels: 1,
      frameSizeMs: 10,
      noiseCancellation: reception,
    });
    const reader = stream.getReader();
    try {
      await work({
        publisher,
        reader,
        roomName,
        identity,
        track,
        reception,
        getStats: () => subscriber.getRtcStats(),
        remoteParticipantSid:
          typeof participant?.sid === 'string' ? participant.sid : undefined,
        waitForTrack: async () => {
          const [next] = await once(subscriber, RoomEvent.TrackSubscribed, {
            signal: AbortSignal.timeout(5000),
          });
          if (!(next instanceof Track))
            throw new Error('Missing subscribed native track');
          return next;
        },
      });
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  } finally {
    try {
      await closeFixturePublisher(publisher, service, roomName);
    } finally {
      await subscriber.disconnect();
      if (await service.exists(roomName)) await service.deleteRoom(roomName);
    }
  }
}
