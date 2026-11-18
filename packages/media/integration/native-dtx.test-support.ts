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
 * the SFU answers (an empty line is no answer either). Session stats, not
 * track stats: a failed track stats call marks the track unreadable for
 * good, and stats fail until the answer.
 */
async function negotiatedOpusFmtp(room: Room) {
  for (const row of (await room.getRtcStats()).publisherStats)
    if (
      row.stats.case === 'codec' &&
      row.stats.value.codec?.mimeType?.toLowerCase() === 'audio/opus' &&
      row.stats.value.codec.sdpFmtpLine
    )
      return row.stats.value.codec.sdpFmtpLine;
  return undefined;
}
const dtxNegotiated = (fmtp: string) =>
  fmtp
    .split(';')
    .map((part) => part.trim())
    .includes('usedtx=1');
/**
 * publishTrack resolves before the SFU answers. This waits for the answer,
 * bounding each stats call too, and polls at 50 ms so that on the loaded
 * hosts where the race happens it does not compete with the negotiation.
 */
async function answeredFmtp(room: Room) {
  const end = performance.now() + ANSWER_MS;
  for (;;) {
    const left = end - performance.now();
    if (left <= 0) return 'no answer';
    const fmtp = await Promise.race([
      negotiatedOpusFmtp(room),
      Bun.sleep(left).then(() => 'no answer'),
    ]);
    if (fmtp !== undefined) return fmtp;
    await Bun.sleep(50);
  }
}
/**
 * The encoder uses DTX only if the SFU's answer carries usedtx=1, which
 * LiveKit adds only when it matches the offer's audio to this track. Under
 * load it sometimes answers unconfigured (`minptime=10;stereo=1;
 * useinbandfec=1`) and the zero source then streams at full cadence: once in
 * about 40 CI runs, one attempt in three on a 2x oversubscribed laptop
 * (ISSUE-1434). The client already waits for the TrackPublished ack before
 * it offers the audio, so the race is inside the SFU, and that answer is
 * final for the publication: only a fresh participant and publication can
 * get another. Three attempts bound the fixture; a run that still has no DTX
 * (or no answer within 5 s) fails here, by name, with each rejected answer,
 * rather than as missing sparse packets.
 */
const DTX_ATTEMPTS = 3,
  ANSWER_MS = 5000;
/**
 * The fixture's worst case before work starts (24 s): every attempt waits out
 * its answer deadline, plus up to 3 s for connect, publish and teardown. A
 * test's timeout adds it to its own budget, so a run that exhausts its
 * attempts fails with the named error, not a runner timeout that cuts the
 * cleanup off.
 * DTX_SETUP_BUDGET_MS = DTX_ATTEMPTS * (ANSWER_MS + 3000)
 */
/** Synthetic source with DTX explicitly requested; not human silence or peer-hearing evidence. */
export async function withDtxSource(
  work: (input: {
    roomName: string;
    identity: string;
    send: (pcm: Int16Array) => Promise<void>;
    sent: () => number;
    /** The answer the publication negotiated, with usedtx=1. */
    fmtp: string;
    /** Answers without DTX that the fixture discarded before this one. */
    rejected: readonly string[];
  }) => Promise<void>,
) {
  const service = createMediaService({ config }),
    roomName = createId(),
    rejected: string[] = [];
  await service.createRoom(roomName);
  try {
    for (let attempt = 1; ; attempt++) {
      // A fresh identity each attempt, so a retry never races the server
      // removing the previous participant.
      const identity = createId(),
        room = new Room(),
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
            `Fixture publisher did not negotiate Opus DTX in ${DTX_ATTEMPTS} attempts: ${rejected.join(' | ')}`,
          );
        }
        await work({
          roomName,
          identity,
          fmtp,
          rejected: [...rejected],
          sent: () => samples,
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
