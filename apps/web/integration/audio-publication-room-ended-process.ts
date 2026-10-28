/**
 * One native publication closed in one ordering, in its own process: rtc-node
 * state left by a room the server deleted must never live on in the shared
 * test runner (ISSUE-789). Prints the outcome as one JSON line.
 */
import { createId } from '@paralleldrive/cuid2';
import { createAudioPublication } from '@daisy/media/audio';
import { createMediaService } from '@daisy/media';
import { localMediaConfig } from './round-media.test-support';

const FRAMES = 5;
const DROP_DEADLINE_MS = 3_000;
const order = process.argv[2];
if (order !== 'racing' && order !== 'dropped' && order !== 'live')
  throw new Error(
    'Usage: audio-publication-room-ended-process racing|dropped|live',
  );

/** The server's drop of a deleted room, or a named failure past the deadline. */
async function dropped(signal: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error('Room deletion never disconnected the publication'),
            ),
          DROP_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const media = createMediaService({ config: localMediaConfig });
const room = createId();
await media.createRoom(room);
let deleted = false;
try {
  const publication = await createAudioPublication({
    url: 'ws://127.0.0.1:7880',
    token: await media.joinToken({
      room,
      identity: createId(),
      publish: ['microphone'],
      subscribe: false,
      capture: false,
    }),
    trackName: createId(),
    sampleRate: 24000,
    channels: 1,
    monotonicNowMs: () => performance.now(),
  });
  for (let frame = 0; frame < FRAMES; frame++)
    await publication.capture10ms(new Int16Array(240));
  if (order !== 'live') {
    await media.deleteRoom(room);
    deleted = true;
  }
  if (order === 'dropped') await dropped(publication.disconnected);
  const usable = publication.usable();
  const closed = await publication.close();
  process.stdout.write(`${JSON.stringify({ usable, ...closed })}\n`);
} finally {
  // A failed ordering never leaves its room behind.
  if (!deleted) await media.deleteRoom(room);
}
process.exit(0);
