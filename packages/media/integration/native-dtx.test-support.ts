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
/**
 * The Opus fmtp the publisher's only sender negotiated, or undefined before
 * the SFU answers. Session stats, not track stats: a failed track stats call
 * marks the track unreadable for good, and stats fail until the answer.
 */
export async function negotiatedOpusFmtp(room: Room) {
  for (const row of (await room.getRtcStats()).publisherStats)
    if (
      row.stats.case === 'codec' &&
      row.stats.value.codec?.mimeType?.toLowerCase() === 'audio/opus'
    )
      return row.stats.value.codec.sdpFmtpLine;
  return undefined;
}
export const dtxNegotiated = (fmtp: string | undefined) =>
  fmtp?.split(';').includes('usedtx=1') === true;
/** publishTrack resolves before the SFU answers; this waits for the answer. */
async function answeredFmtp(room: Room) {
  const end = performance.now() + 5000;
  for (;;) {
    const fmtp = await negotiatedOpusFmtp(room);
    if (fmtp !== undefined) return fmtp;
    if (performance.now() >= end)
      throw new Error('Fixture publisher offer was never answered');
    await Bun.sleep(10);
  }
}
/**
 * The encoder uses DTX only if the SFU's answer carries usedtx=1, which
 * LiveKit adds only when it matches the offer's audio to this track. Under
 * load it sometimes answers unconfigured (`minptime=10;stereo=1;
 * useinbandfec=1`) and the zero source then streams at full cadence: once in
 * about 40 CI runs, one attempt in three on a 2x oversubscribed laptop
 * (ISSUE-1434). That answer is final for the publication, so a fresh
 * connection and publication is the only remedy. Three attempts bound the
 * fixture; a run that still has no DTX fails here, by name, with each
 * rejected answer, rather than as missing sparse packets.
 */
const DTX_ATTEMPTS = 3;
/** Synthetic source with DTX explicitly requested; not human silence or peer-hearing evidence. */
export async function withDtxSource(
  work: (input: {
    roomName: string;
    identity: string;
    send: (pcm: Int16Array) => Promise<void>;
    sent: () => number;
    fmtp: () => Promise<string | undefined>;
    /** Answers without DTX that the fixture discarded before this one. */
    rejected: readonly string[];
  }) => Promise<void>,
) {
  const service = createMediaService({ config }),
    roomName = createId(),
    identity = createId(),
    rejected: string[] = [];
  await service.createRoom(roomName);
  try {
    for (let attempt = 1; ; attempt++) {
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
        if (!room.localParticipant)
          throw new Error('Missing fixture publisher');
        await room.localParticipant.publishTrack(
          track,
          new TrackPublishOptions({
            source: TrackSource.SOURCE_MICROPHONE,
            dtx: true,
            red: false,
          }),
        );
        const fmtp = await answeredFmtp(room);
        if (!dtxNegotiated(fmtp)) {
          rejected.push(fmtp);
          if (attempt < DTX_ATTEMPTS) continue;
          throw new Error(
            `Fixture publisher did not negotiate Opus DTX in ${DTX_ATTEMPTS} answers: ${rejected.join(' | ')}`,
          );
        }
        await work({
          roomName,
          identity,
          rejected: [...rejected],
          sent: () => samples,
          fmtp: () => negotiatedOpusFmtp(room),
          send: async (pcm) => {
            if (pcm.length !== 480) throw new Error('Invalid fixture frame');
            await source.captureFrame(new AudioFrame(pcm, 48000, 1, 480));
            samples += 480;
          },
        });
        return;
      } finally {
        try {
          await track.close();
        } finally {
          await room.disconnect();
        }
      }
    }
  } finally {
    if (await service.exists(roomName)) await service.deleteRoom(roomName);
  }
}
