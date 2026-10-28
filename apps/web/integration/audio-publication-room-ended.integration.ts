import { createId } from '@paralleldrive/cuid2';
import { createAudioPublication } from '@daisy/media/audio';
import { createMediaService } from '@daisy/media';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { localMediaConfig } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

const FRAMES = 5;
const DROP_DEADLINE_MS = 10_000;

/** The server's drop of a deleted room, or a named failure past the deadline. */
const dropped = (signal: Promise<void>) =>
  Promise.race([
    signal,
    Bun.sleep(DROP_DEADLINE_MS).then(() => {
      throw new Error('Room deletion never disconnected the publication');
    }),
  ]);

/** A native publication that sent a few frames into a fresh room. */
async function publishing() {
  const media = createMediaService({ config: localMediaConfig });
  const room = createId();
  await media.createRoom(room);
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
  return { media, room, publication };
}

test('a native publication closes when its room is deleted, before the drop arrives (ISSUE-789)', async () => {
  const { media, room, publication } = await publishing();
  await media.deleteRoom(room);
  assert({
    given: 'Round cleanup deleting the room, with close racing the drop',
    should: 'close without a refusal and report the samples it sent',
    actual: await publication.close(),
    expected: { consumedSamples: FRAMES * 240 },
  });
});

test('a native publication closes after its deleted room dropped it (ISSUE-789)', async () => {
  const { media, room, publication } = await publishing();
  await media.deleteRoom(room);
  await dropped(publication.disconnected);
  assert({
    given: 'a bot publication the server already disconnected',
    should: 'close without a refusal and report the samples it sent',
    actual: [publication.usable(), await publication.close()],
    expected: [false, { consumedSamples: FRAMES * 240 }],
  });
});

test('a native publication in a live room unpublishes and closes', async () => {
  const { media, room, publication } = await publishing();
  try {
    assert({
      given: 'a bot publication whose room is still open',
      should: 'close and report the samples it sent',
      actual: await publication.close(),
      expected: { consumedSamples: FRAMES * 240 },
    });
  } finally {
    await media.deleteRoom(room);
  }
});
