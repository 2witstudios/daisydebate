import { assert, setupRitewayBun, test } from 'riteway/bun';
import { connectionOf } from './media-status';
import { answerOf, driver } from './media-driver.test-support';
import type { Source } from './media-state';

setupRitewayBun();

const view = (roundViewVersion: number) =>
  ({
    type: 'read-requested',
    read: { kind: 'view', roundViewVersion },
  }) as const;

/** PR 540's races, on the model: reads, the grants applied and the answers announced. */
const racing = () => {
  const d = driver();
  d.join();
  const applied = [d.live().grants.join('+')];
  const receipts: string[] = [];
  let shown = answerOf(d.live())?.media;
  const reads = () => d.count('start-read') + 1;
  const note = () => {
    const live = d.state().link.phase === 'live' ? d.live() : null;
    if (live && live.grants.join('+') !== applied.at(-1))
      applied.push(live.grants.join('+'));
    const media = live && answerOf(live)?.media;
    if (media && media !== shown) {
      shown = media;
      receipts.push(media.grants.publish.join('+'));
    }
  };
  const wake = () => {
    d.send({ type: 'read-requested', read: { kind: 'wake' } });
    d.flushDeferred();
  };
  /** An apply that holds at this source's SDK publish. */
  const holdApply = (publish: readonly Source[]) => {
    wake();
    d.answer(publish);
    note();
    for (const source of publish) d.room({ type: 'captured', source });
    note();
  };
  return { d, applied, receipts, reads, note, holdApply };
};

test('a queued fresh reply superseded while waiting for the old apply never starts', () => {
  const { d, applied, receipts, reads, note, holdApply } = racing();
  holdApply(['camera', 'microphone']);
  d.send(view(4));
  d.flushDeferred();
  d.answer(['microphone']);
  note();
  d.send(view(5));
  d.flushDeferred();
  d.answer(['camera']);
  note();
  const held = [reads(), [...applied]];
  d.room({ type: 'published', source: 'camera' });
  d.room({ type: 'published', source: 'microphone' });
  note();
  d.room({ type: 'unpublished', source: 'microphone' });
  note();
  assert({
    given: 'two newer views while an old SDK apply is still running',
    should:
      'read fresh for both, skip the superseded queued apply, and apply and announce only the last',
    actual: [held, applied, receipts],
    expected: [
      [4, ['', 'camera+microphone']],
      ['', 'camera+microphone', 'camera'],
      ['camera'],
    ],
  });
});

test('already-started SDK work serializes fresh application without blocking a fresh read', () => {
  const { d, applied, receipts, reads, note, holdApply } = racing();
  holdApply(['camera', 'microphone']);
  d.send(view(4));
  d.flushDeferred();
  d.answer(['camera']);
  note();
  const held = [reads(), applied.length, receipts.length];
  d.room({ type: 'published', source: 'camera' });
  d.room({ type: 'published', source: 'microphone' });
  note();
  d.room({ type: 'unpublished', source: 'microphone' });
  note();
  assert({
    given: 'a newer view while SDK apply has already begun',
    should:
      'read fresh immediately but serialize SDK work and announce only the current ticket',
    actual: [held, applied, receipts],
    expected: [[3, 2, 0], ['', 'camera+microphone', 'camera'], ['camera']],
  });
});

test('an old apply finishing after its successor failed cannot revive media', () => {
  const { d, holdApply } = racing();
  holdApply(['camera']);
  const connection = d.live().connection;
  d.send(view(4));
  d.flushDeferred();
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'refused' });
  const failed = [connectionOf(d.state()), d.count('release-connection')];
  const settled = d.state();
  const late = d.send({ type: 'published', source: 'camera', connection });
  assert({
    given:
      'a superseded apply still running when the current read fails definitively',
    should:
      'report the failure, release once, and fence the old apply when it settles',
    actual: [
      failed,
      late.state === settled,
      late.effects,
      connectionOf(d.state()),
    ],
    expected: [['unavailable', 1], true, [], 'unavailable'],
  });
});

test('an old already-started SDK rejection cannot fail its successor', () => {
  const { d, receipts, reads, note, holdApply } = racing();
  holdApply(['camera']);
  d.send(view(4));
  d.flushDeferred();
  d.answer(['camera']);
  note();
  d.room({ type: 'publish-failed', source: 'camera', kind: 'failure' });
  d.room({ type: 'captured', source: 'microphone' });
  note();
  assert({
    given:
      'an already-started publish rejects after a newer intent has read fresh media',
    should:
      'name that source, apply the fresh answer and announce only it, without teardown',
    actual: [
      reads(),
      d.count('release-connection'),
      receipts,
      connectionOf(d.state()),
      d.live().sources.camera.phase,
    ],
    expected: [3, 0, ['camera'], 'live', 'failed'],
  });
});

test('a fresh read never waits for an older apply, however many reads came first', () => {
  const { d, reads, holdApply } = racing();
  holdApply(['camera']);
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  const wanted = d.live().reads.next;
  d.flushDeferred();
  const behind = reads();
  d.send(view(4));
  d.flushDeferred();
  assert({
    given: 'a wake held behind the current apply, then a newer view',
    should: 'start a read for the view though that apply has not settled',
    actual: [wanted, behind, reads()],
    expected: ['wanted', 2, 3],
  });
});

test('a replaced schedule firing late is rejected', () => {
  const d = driver();
  d.join();
  d.send({ type: 'read-requested', read: { kind: 'wake' } });
  d.flushDeferred();
  d.send({ type: 'read-failed', ticket: d.ticket(), failure: 'definite' });
  d.send(view(2));
  const first = d.state().timers['read-budget'] ?? -1;
  d.flushDeferred();
  d.answer();
  d.send(view(3));
  const before = d.state();
  const late = d.send({ type: 'timer-fired', timer: 'read-budget', id: first });
  assert({
    given:
      'a read budget that was cancelled, a new one set, and the old firing',
    should: 'ignore the firing and keep the new budget running',
    actual: [
      late.state === before,
      late.effects,
      d.state().timers['read-budget'] !== first,
      connectionOf(d.state()),
    ],
    expected: [true, [], true, 'live'],
  });
});
