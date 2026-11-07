import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { createId } from '@paralleldrive/cuid2';
import { createMediaService } from '../src/service';
import { config } from './native-room.test-support';
/** Synthetic source with DTX explicitly requested; not human silence or peer-hearing evidence. */
export async function withDtxSource(
  work: (input: {
    roomName: string;
    identity: string;
    send: (pcm: Int16Array) => Promise<void>;
    sent: () => number;
  }) => Promise<void>,
) {
  const service = createMediaService({ config }),
    roomName = createId(),
    identity = createId();
  await service.createRoom(roomName);
  const room = new Room(),
    source = new AudioSource(48000, 1, 0),
    track = LocalAudioTrack.createAudioTrack(createId(), source);
  let samples = 0;
  try {
    await room.connect(
      'ws://127.0.0.1:7880',
      await service.joinToken({
        room: roomName,
        identity,
        publish: ['microphone'],
        subscribe: false,
        capture: false,
      }),
      { autoSubscribe: false, dynacast: false },
    );
    if (!room.localParticipant) throw new Error('Missing fixture publisher');
    await room.localParticipant.publishTrack(
      track,
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        dtx: true,
        red: false,
      }),
    );
    await work({
      roomName,
      identity,
      sent: () => samples,
      send: async (pcm) => {
        if (pcm.length !== 480) throw new Error('Invalid fixture frame');
        await source.captureFrame(new AudioFrame(pcm, 48000, 1, 480));
        samples += 480;
      },
    });
  } finally {
    try {
      await track.close();
    } finally {
      try {
        await room.disconnect();
      } finally {
        if (await service.exists(roomName)) await service.deleteRoom(roomName);
      }
    }
  }
}
