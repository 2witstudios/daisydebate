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
 * good, and track stats fail until the answer.
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
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/**
 * publishTrack resolves before the SFU answers. This waits for the answer
 * under one deadline that also bounds each stats call (a failed call is
 * polled again; no stats promise is left without a handler), and polls at
 * 50 ms so that on the loaded hosts where the race happens it does not
 * compete with the negotiation. Undefined when no answer came in time.
 */
async function answeredFmtp(room: Room) {
  let expired = false;
  const deadline = Bun.sleep(ANSWER_MS).then(() => {
    expired = true;
    return undefined;
  });
  while (!expired) {
    const fmtp = await Promise.race([
      negotiatedOpusFmtp(room).catch(() => undefined),
      deadline,
    ]);
    if (fmtp !== undefined) return fmtp;
    await Promise.race([Bun.sleep(50), deadline]);
  }
  return undefined;
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
 * fails here, by name, with every failed attempt, rather than as missing
 * sparse packets.
 */
const DTX_ATTEMPTS = 3,
  ANSWER_MS = 5000,
  JOIN_MS = 2000;
/**
 * The fixture's worst case before work starts (24 s): every attempt can use
 * its connect-and-publish deadline (a slow join is a failed attempt) and its
 * answer deadline, plus a 1 s allowance for teardown. Teardown is not cut
 * short, because an abandoned native close can leak the publication. A
 * test's timeout adds this budget to its own, so a run that uses up its
 * attempts fails with the named error, not a runner timeout that cuts the
 * cleanup off.
 */
export const DTX_SETUP_BUDGET_MS = DTX_ATTEMPTS * (JOIN_MS + ANSWER_MS + 1000);
/**
 * One attempt: join and publish within JOIN_MS, then wait for the answer.
 * Every failure is caught and named so that it shares the attempt bound.
 */
async function negotiate(
  room: Room,
  track: LocalAudioTrack,
  token: string,
): Promise<{ readonly fmtp: string } | { readonly failure: string }> {
  const joining = (async () => {
    await room.connect('ws://127.0.0.1:7880', token, {
      autoSubscribe: false,
      dynacast: false,
    });
    if (!room.localParticipant) throw new Error('Missing fixture publisher');
    await room.localParticipant.publishTrack(
      track,
      new TrackPublishOptions({
        source: TrackSource.SOURCE_MICROPHONE,
        dtx: true,
        red: false,
      }),
    );
  })().then(() => null, reason);
  const joined = await Promise.race([
    joining,
    Bun.sleep(JOIN_MS).then(() => `no join within ${JOIN_MS} ms`),
  ]);
  if (joined !== null) return { failure: joined };
  const fmtp = await answeredFmtp(room);
  if (fmtp === undefined)
    return { failure: `no answer within ${ANSWER_MS} ms` };
  return dtxNegotiated(fmtp) ? { fmtp } : { failure: fmtp };
}
/** Synthetic source with DTX explicitly requested; not human silence or peer-hearing evidence. */
export async function withDtxSource(
  work: (input: {
    roomName: string;
    identity: string;
    send: (pcm: Int16Array) => Promise<void>;
    sent: () => number;
    /** The answer the publication negotiated, with usedtx=1. */
    fmtp: string;
    /** Failed attempts before this one: an answer without DTX, or why none came. */
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
        const answer = await negotiate(
          room,
          track,
          await service.joinToken({
            room: roomName,
            identity,
            publish: ['microphone'],
            subscribe: false,
            capture: false,
          }),
        );
        if ('failure' in answer) {
          rejected.push(answer.failure);
          if (attempt < DTX_ATTEMPTS) continue;
          throw new Error(
            `Fixture publisher did not negotiate Opus DTX in ${DTX_ATTEMPTS} attempts: ${rejected.join(' | ')}`,
          );
        }
        await work({
          roomName,
          identity,
          fmtp: answer.fmtp,
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
