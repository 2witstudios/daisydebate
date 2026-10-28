import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { peer, session } from './listening.test-support';

setupRitewayBun();

test('a dropped connection rejoins with a fresh grant; a refused rejoin backs off and joins once admitted (ISSUE-764)', async () => {
  let refusal: Error | undefined = undefined;
  const s = session({ refuse: () => refusal });
  s.listening.start();
  await s.joined();
  s.expectJoin();
  s.subscriptions[0]!.drop();
  await Promise.resolve();
  await s.listening.poll();
  const beforePause = s.subscriptions.length;
  s.advance(1000);
  await s.listening.poll();
  await s.joined();
  // A revocation still settling refuses the rejoin; it clears on its own.
  refusal = createAppError('CONFLICT', 'Round media admission is closed');
  s.expectJoin();
  s.subscriptions[1]!.drop();
  await Promise.resolve();
  s.advance(1000);
  await s.listening.poll();
  const refusedGrants = s.grants.length;
  refusal = undefined;
  s.advance(2000);
  await s.listening.poll();
  await s.joined();
  assert({
    given:
      'a drop, a rejoin after its pause, then a drop whose first rejoin is refused with CONFLICT',
    should:
      'rejoin with a fresh grant each time, and join again once the refusal clears',
    actual: {
      beforePause,
      refusedGrants,
      subscriptions: s.subscriptions.map((sub) => sub.token),
    },
    expected: {
      beforePause: 1,
      refusedGrants: 3,
      subscriptions: ['listen-1', 'listen-2', 'listen-4'],
    },
  });
});

test('a respondent bot refused its first grant for want of the floor still hears once admitted', async () => {
  let refusals = 1;
  const s = session({
    refuse: () =>
      refusals-- > 0
        ? createAppError('CONFLICT', 'Bot speaking authority changed')
        : undefined,
  });
  s.listening.start();
  for (let poll = 0; poll < 3; poll++) {
    s.advance(500);
    await s.listening.poll();
  }
  await s.joined();
  assert({
    given: 'a cross-ex seat whose first listen grant is refused with CONFLICT',
    should:
      'ask again after its pause and join, reporting nothing: a routine refusal is no fault',
    actual: {
      grants: s.grants.length,
      subscriptions: s.subscriptions.length,
      failures: s.failures,
    },
    expected: {
      grants: 2,
      subscriptions: 1,
      failures: [],
    },
  });
});

test('a refusal that persists is reported once every five joins', async () => {
  const s = session({
    refuse: () => createAppError('AUTHORIZATION', 'Bot claim changed'),
  });
  s.listening.start();
  for (let poll = 0; poll < 60; poll++) {
    s.advance(5000);
    await s.listening.poll();
    await Promise.resolve();
  }
  assert({
    given:
      'a listen grant refused with AUTHORIZATION on every join for 5 minutes',
    should:
      'report it on the fifth and tenth refusal only, never on each back-off',
    actual: { reported: s.failures.length, asked: s.grants.length },
    expected: { reported: 2, asked: 14 },
  });
});

test('an unexpected failure breaks a run of refusals', async () => {
  const outcomes = [
    ...Array<'refuse'>(4).fill('refuse'),
    'fail',
    ...Array<'refuse'>(4).fill('refuse'),
  ];
  const s = session({
    refuse: () => {
      const next = outcomes.shift();
      if (next === 'refuse') return createAppError('CONFLICT', 'Busy');
      return next === 'fail' ? new Error('media unreachable') : undefined;
    },
  });
  s.listening.start();
  while (outcomes.length) {
    s.advance(30_000);
    await s.listening.poll();
    await Promise.resolve();
  }
  assert({
    given: 'four refusals, one unexpected failure, then four more refusals',
    should: 'report only the unexpected failure: neither run reached five',
    actual: s.failures,
    expected: ['media unreachable'],
  });
});

test('a transient join failure backs off, doubling to a ceiling, and a failed cleanup counts as a drop', async () => {
  let failures = 3;
  const s = session({
    refuse: () => (failures-- > 0 ? new Error('media unreachable') : undefined),
  });
  s.listening.start();
  const attemptsAt: number[] = [];
  for (let elapsed = 0; elapsed <= 7000; elapsed += 500) {
    const before = s.grants.length;
    await s.listening.poll();
    await Promise.resolve();
    if (s.grants.length > before) attemptsAt.push(elapsed);
    s.advance(500);
  }
  await s.joined();
  s.expectJoin();
  s.subscriptions[0]!.fail();
  await Promise.resolve();
  await Promise.resolve();
  s.advance(1000);
  await s.listening.poll();
  await s.joined();
  assert({
    given:
      'three transient join failures, then a subscription whose `closed` rejects',
    should:
      'report each, retry after 1 s, 2 s and 4 s, then treat the rejected close as a drop and rejoin',
    actual: {
      attemptsAt,
      subscriptions: s.subscriptions.map((sub) => sub.token),
      failures: s.failures,
    },
    expected: {
      attemptsAt: [1000, 3000, 7000],
      subscriptions: ['listen-4', 'listen-5'],
      failures: ['media unreachable', 'media unreachable', 'media unreachable'],
    },
  });
});

test('a failing reporter never turns a failed join into a join on every poll', async () => {
  const s = session({
    refuse: () => new Error('media unreachable'),
    reportThrows: true,
  });
  s.listening.start();
  for (let poll = 0; poll < 10; poll++) {
    s.advance(50);
    await s.listening.poll().catch(() => undefined);
    await Promise.resolve();
  }
  assert({
    given:
      'a join that fails, reported to a reporter that throws, then 500 ms of polls',
    should: 'still back off: one grant asked for, not one per poll',
    actual: s.grants.length,
    expected: 1,
  });
});

/** A joined, polled listener whose PostgreSQL time reads take `clock.readMs` and are counted. */
async function timedReads(readMs: number) {
  const clock = { readMs, reads: 0 };
  const s = session({
    readMs: () => {
      clock.reads++;
      return clock.readMs;
    },
  });
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  return { s, clock };
}

test('a slow first calibration read is retried within 200 ms, never on every poll', async () => {
  const { s, clock } = await timedReads(150);
  for (let poll = 0; poll < 10; poll++) await s.listening.poll();
  s.speak(['peer-identity']);
  const slow = { events: [...s.events], reads: clock.reads };
  clock.readMs = 0;
  await s.listening.poll();
  s.speak(['peer-identity'], 20);
  assert({
    given:
      'a first calibration read with a 150 ms round trip, ten more polls within it, 200 ms of speech, then a prompt read',
    should:
      'read once and hear nothing while uncalibrated, then hear the peer once the retry calibrates',
    actual: { slow, events: s.events, reads: clock.reads },
    expected: {
      slow: { events: [], reads: 1 },
      events: [`speech-start:${peer}`],
      reads: 2,
    },
  });
});

test('a calibrated listener re-reads PostgreSQL time once a second, however slow the reads', async () => {
  const { s, clock } = await timedReads(0);
  clock.readMs = 150;
  for (let poll = 0; poll < 40; poll++) {
    s.advance(50);
    await s.listening.poll();
  }
  assert({
    given: 'a calibrated listener polled every 50 ms for 2 s of slow reads',
    should: 'read at the start and once each second after, not on every poll',
    actual: clock.reads,
    expected: 3,
  });
});
