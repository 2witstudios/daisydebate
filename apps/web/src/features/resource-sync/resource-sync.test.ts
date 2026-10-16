import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  resourceSync,
  seedResourceSync,
  shouldRead,
  type ResourceEvent,
  type ResourceSync,
} from './resource-sync';

import {
  doc as makeDoc,
  docIdentity,
  type Doc,
} from './resource-sync.test-support';

setupRitewayBun();

const identity = docIdentity;
const sync = resourceSync(identity);
const doc = (version: number, label = 'held') => makeDoc(version, label);
const seeded = seedResourceSync(identity, doc(3), 1000);
const run = (
  state: ResourceSync<Doc>,
  ...events: readonly ResourceEvent<Doc>[]
) => events.reduce(sync, state);
const found = (version: number, label = 'read', at = 2000) =>
  ({ type: 'found', value: doc(version, label), at }) as const;
const summary = (state: ResourceSync<Doc>) => ({
  value: `${state.value.version}:${state.value.label}`,
  freshness: state.freshness,
  read: shouldRead(state),
});

describe('resourceSync', () => {
  test('a seeded resource is current and reads nothing', () => {
    assert({
      given: 'the server-rendered value',
      should: 'be current with no read due',
      actual: summary(seeded),
      expected: { value: '3:held', freshness: 'current', read: false },
    });
  });

  test('a doorbell the held value covers is ignored', () => {
    assert({
      given: 'doorbells announcing an older and the same version',
      should: 'leave the resource unchanged',
      actual: run(
        seeded,
        { type: 'signal', version: 2 },
        { type: 'signal', version: 3 },
      ),
      expected: seeded,
    });
  });

  test('a newer doorbell or a version-less signal makes a read due', () => {
    assert({
      given: 'a doorbell announcing a newer version, and a backstop signal',
      should: 'make one read due',
      actual: [
        shouldRead(run(seeded, { type: 'signal', version: 4 })),
        shouldRead(run(seeded, { type: 'signal', version: null })),
      ],
      expected: [true, true],
    });
  });

  test('reads are single-flight with at most one more due', () => {
    const reading = run(
      seeded,
      { type: 'signal', version: null },
      { type: 'read' },
    );
    const signalled = run(reading, { type: 'signal', version: 5 });
    assert({
      given: 'a read in flight and then a doorbell for a newer version',
      should: 'start no second read until the first settles, then read again',
      actual: [
        shouldRead(reading),
        shouldRead(signalled),
        summary(run(signalled, found(4))),
      ],
      expected: [
        false,
        false,
        { value: '4:read', freshness: 'current', read: true },
      ],
    });
  });

  test('a read that answers the announced version settles the resource', () => {
    assert({
      given: 'a doorbell for version 4 and a read that returns version 4',
      should: 'adopt it and read nothing more',
      actual: summary(
        run(seeded, { type: 'signal', version: 4 }, { type: 'read' }, found(4)),
      ),
      expected: { value: '4:read', freshness: 'current', read: false },
    });
  });

  test('an older value never rolls the resource back', () => {
    const accepted = run(seeded, {
      type: 'accepted',
      value: doc(5, 'accepted'),
      at: 1500,
    });
    assert({
      given: 'a command answer at version 5, then a slower read of version 4',
      should: 'keep the accepted value',
      actual: summary(run(accepted, { type: 'read' }, found(4, 'old'))),
      expected: { value: '5:accepted', freshness: 'current', read: false },
    });
  });

  test('the same version re-read is adopted and re-anchors time', () => {
    const next = run(seeded, { type: 'read' }, found(3, 'later', 9000));
    assert({
      given: 'a read returning the version already held',
      should: 'adopt its time-derived fields and anchor time to that read',
      actual: [summary(next).value, next.readAt],
      expected: ['3:later', 9000],
    });
  });

  test('a failed read keeps the last value as stale and loops nothing', () => {
    const stale = run(
      seeded,
      { type: 'signal', version: 4 },
      { type: 'read' },
      { type: 'unavailable' },
    );
    assert({
      given:
        'a doorbell whose read cannot reach the resource, then a later read that can',
      should: 'keep the value as stale with no read due, then become current',
      actual: [
        summary(stale),
        summary(
          run(
            stale,
            { type: 'signal', version: null },
            { type: 'read' },
            found(4),
          ),
        ),
      ],
      expected: [
        { value: '3:held', freshness: 'stale', read: false },
        { value: '4:read', freshness: 'current', read: false },
      ],
    });
  });

  test('a resource that no longer reads is gone and stops reading', () => {
    const gone = run(
      seeded,
      { type: 'signal', version: null },
      { type: 'read' },
      { type: 'missing' },
      { type: 'signal', version: 9 },
    );
    assert({
      given: 'a read answering missing, then another doorbell',
      should: 'mark the resource gone and read nothing more',
      actual: [gone.freshness, shouldRead(gone)],
      expected: ['gone', false],
    });
  });

  test('a value for another resource is never adopted', () => {
    const foreign = {
      type: 'found',
      value: { id: 'd2', version: 9, label: 'x' },
      at: 2000,
    } as const;
    assert({
      given:
        'a read answering a different identity, and a command answer for one',
      should: 'treat the read as unavailable and ignore the answer',
      actual: [
        summary(run(seeded, { type: 'read' }, foreign)),
        run(seeded, { ...foreign, type: 'accepted' }) === seeded,
      ],
      expected: [{ value: '3:held', freshness: 'stale', read: false }, true],
    });
  });

  test('an equal version can keep what the held value already offered', () => {
    const keeping = resourceSync({
      ...identity,
      sameVersion: (held: Doc, next: Doc) => ({ ...next, label: held.label }),
    });
    assert({
      given: 'a resource whose equal-version reads keep the held label',
      should:
        'adopt the read but keep the label, and adopt a newer version whole',
      actual: [
        keeping(keeping(seeded, { type: 'read' }), found(3, 'later')).value
          .label,
        keeping(keeping(seeded, { type: 'read' }), found(4, 'newer')).value
          .label,
      ],
      expected: ['held', 'newer'],
    });
  });
});
