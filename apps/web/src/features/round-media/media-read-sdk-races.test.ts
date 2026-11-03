import { assert, setupRitewayBun, test } from 'riteway/bun';
import { settle } from './adapters/livekit-room.test-support';
import { mediaFailure } from './media-failure';
import { sdkWorld as world } from './media-sdk-world.test-support';
import type { Source } from './model/media-state';
import { connectionOf } from './model/media-status';
import { answerWith } from './model/media-state.test-support';

setupRitewayBun();

const publish = (...sources: readonly Source[]) => answerWith(sources);

test('through the adapter: a queued fresh reply superseded during the old apply never starts', async () => {
  const applying = Promise.withResolvers<void>();
  const replies = [[], ['camera', 'microphone'], ['microphone'], ['camera']];
  const w = await world({
    replies: (read) => publish(...((replies[read - 1] ?? []) as Source[])),
    sdk: { publishGates: [applying.promise] },
  });
  await w.send({ kind: 'wake' });
  await w.send({ kind: 'view', roundViewVersion: 4 });
  await w.send({ kind: 'view', roundViewVersion: 5 });
  const held = [w.reads(), [...w.applied]];
  applying.resolve();
  await settle();
  assert({
    given: 'two newer views while an old SDK publish is still running',
    should:
      'read fresh for both, skip the superseded queued apply, and apply and announce only the last',
    actual: [held, w.applied, w.receipts],
    expected: [
      [4, ['', 'camera+microphone']],
      ['', 'camera+microphone', 'camera'],
      ['camera'],
    ],
  });
  w.stop();
});

test('through the adapter: already-started SDK work serializes without blocking a fresh read', async () => {
  const applying = Promise.withResolvers<void>();
  const replies = [[], ['camera', 'microphone'], ['camera']];
  const w = await world({
    replies: (read) => publish(...((replies[read - 1] ?? []) as Source[])),
    sdk: { publishGates: [applying.promise] },
  });
  await w.send({ kind: 'wake' });
  await w.send({ kind: 'view', roundViewVersion: 4 });
  const held = [w.reads(), w.applied.length, w.receipts.length];
  applying.resolve();
  await settle();
  assert({
    given: 'a newer view while an SDK publish has already begun',
    should:
      'read fresh immediately but serialize SDK work and announce only the current answer',
    actual: [held, w.applied, w.receipts],
    expected: [[3, 2, 0], ['', 'camera+microphone', 'camera'], ['camera']],
  });
  w.stop();
});

test('through the adapter: a publish finishing after its successor failed cannot revive media', async () => {
  const applying = Promise.withResolvers<void>();
  const w = await world({
    replies: (read) => {
      if (read === 3) throw mediaFailure(403);
      return read === 2 ? publish('camera') : publish();
    },
    sdk: { publishGates: [applying.promise] },
  });
  await w.send({ kind: 'wake' });
  await w.send({ kind: 'view', roundViewVersion: 4 });
  const camera = w.stub.captured.find((track) => track.source === 'camera');
  const failed = [connectionOf(w.runtime.state()), camera?.ended];
  const settledState = w.runtime.state();
  applying.resolve();
  await settle();
  assert({
    given:
      'a superseded publish still running when the current read fails definitively',
    should:
      'report the failure and stop the track at once, and leave it stopped and unwatched when the publish settles',
    actual: [
      failed,
      camera?.ended,
      camera?.listening(),
      w.runtime.state() === settledState,
      connectionOf(w.runtime.state()),
    ],
    expected: [['unavailable', true], true, 0, true, 'unavailable'],
  });
});

test('through the adapter: an old already-started SDK rejection cannot fail its successor', async () => {
  const applying = Promise.withResolvers<void>();
  const w = await world({
    replies: (read) => (read === 1 ? publish() : publish('camera')),
    sdk: { publishGates: [applying.promise] },
  });
  await w.send({ kind: 'wake' });
  await w.send({ kind: 'view', roundViewVersion: 4 });
  applying.reject(new Error('Obsolete SDK failure'));
  await settle();
  const { link } = w.runtime.state();
  assert({
    given:
      'an already-started publish rejects after a newer intent has read fresh media',
    should:
      'observe the rejection, apply the fresh answer and announce only it, without teardown',
    actual: [
      w.reads(),
      w.stub.captured.some(
        (track) => track.ended && track.source === 'microphone',
      ),
      w.receipts,
      connectionOf(w.runtime.state()),
      link.phase === 'live' ? link.sources.camera.phase : null,
    ],
    expected: [3, false, ['camera'], 'live', 'failed'],
  });
  w.stop();
});
