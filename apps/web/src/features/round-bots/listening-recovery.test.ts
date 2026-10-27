import { createAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { peer, session } from './listening.test-support';

setupRitewayBun();

test('a dropped connection rejoins with a fresh grant; a definite refusal stops it for good (ISSUE-764)', async () => {
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
  // The Round ends or the seat is revoked: its admission refuses the bot.
  refusal = createAppError('CONFLICT', 'Round media admission is closed');
  s.subscriptions[1]!.drop();
  await Promise.resolve();
  s.advance(1000);
  await s.listening.poll();
  for (let poll = 0; poll < 5; poll++) {
    s.advance(60_000);
    await s.listening.poll();
  }
  assert({
    given:
      'a drop, a rejoin after its pause, then a drop whose rejoin the admission refuses with CONFLICT',
    should:
      'rejoin once with a fresh grant, then never ask again: a revoked seat hears nothing',
    actual: {
      beforePause,
      subscriptions: s.subscriptions.map((sub) => sub.token),
      grants: s.grants.length,
    },
    expected: {
      beforePause: 1,
      subscriptions: ['listen-1', 'listen-2'],
      grants: 3,
    },
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
      'retry after 1 s, 2 s and 4 s, then treat the rejected close as a drop and rejoin',
    actual: {
      attemptsAt,
      subscriptions: s.subscriptions.map((sub) => sub.token),
    },
    expected: {
      attemptsAt: [1000, 3000, 7000],
      subscriptions: ['listen-4', 'listen-5'],
    },
  });
});

test('a slow PostgreSQL time read never calibrates the listener', async () => {
  let readMs = 150;
  const s = session({ readMs: () => readMs });
  s.listening.start();
  await s.joined();
  await s.listening.poll();
  s.speak(['peer-identity']);
  const slow = [...s.events];
  readMs = 0;
  await s.listening.poll();
  s.speak(['peer-identity'], 20);
  assert({
    given:
      'a calibration read with a 150 ms round trip, then a prompt one on the next poll',
    should:
      'hear nothing while uncalibrated, then hear the peer once the next poll calibrates',
    actual: { slow, events: s.events },
    expected: { slow: [], events: [`speech-start:${peer}`] },
  });
});
