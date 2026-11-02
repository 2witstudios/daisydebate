import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { decideBroadcast, type BroadcastFacts } from './broadcast-lifecycle';

setupRitewayBun();

const facts = (over: Partial<BroadcastFacts> = {}): BroadcastFacts => ({
  nowMs: 100_000,
  roundStatus: 'active',
  roundEndedAtMs: null,
  stoppedAtMs: null,
  completedAtMs: null,
  egress: { kind: 'none' },
  phase: { kind: 'public' },
  observerSubscribed: true,
  revocationFailures: 0,
  finalMediaEndMs: null,
  releasedThroughMs: null,
  policy: { kind: 'delay', seconds: 60 },
  ...over,
});
const active = { kind: 'active', id: 'EG_1' } as const;

describe('starting and restarting', () => {
  test('a live Round has one Egress, restarted when it dies', () => {
    assert({
      given: 'a live Round and no Egress',
      should: 'start one',
      actual: decideBroadcast(facts()),
      expected: [{ type: 'start-egress' }],
    });
    assert({
      given: 'a live Round whose Egress failed',
      should: 'start another and touch nothing else',
      actual: decideBroadcast(
        facts({ egress: { kind: 'failed', id: 'EG_1' } }),
      ),
      expected: [{ type: 'start-egress' }],
    });
    assert({
      given: 'a live Round whose Egress is starting or active',
      should: 'not start a second',
      actual: [
        decideBroadcast(facts({ egress: { kind: 'starting', id: 'EG_1' } })),
        decideBroadcast(facts({ egress: active })),
      ],
      expected: [[], []],
    });
  });
  test('a scheduled Round starts early so it is live before the first speech', () => {
    assert({
      given: 'a scheduled Round with no Egress',
      should: 'start one',
      actual: decideBroadcast(facts({ roundStatus: 'scheduled' })),
      expected: [{ type: 'start-egress' }],
    });
  });
});

describe('private phases fail closed', () => {
  const upcoming = (inMs: number) =>
    ({ kind: 'private-at', atMs: 100_000 + inMs }) as const;
  test('the observer loses subscribe at least 500 ms ahead', () => {
    assert({
      given: 'a private phase 500 ms away and the observer still subscribed',
      should: 'revoke now',
      actual: decideBroadcast(facts({ egress: active, phase: upcoming(500) })),
      expected: [{ type: 'revoke-observer' }],
    });
    assert({
      given: 'a private phase 5 s away',
      should: 'not revoke yet',
      actual: decideBroadcast(facts({ egress: active, phase: upcoming(5000) })),
      expected: [],
    });
  });
  test('an unconfirmed revocation stops the Egress', () => {
    assert({
      given: 'a revocation that failed',
      should: 'stop the Egress rather than risk private media',
      actual: decideBroadcast(
        facts({ egress: active, phase: upcoming(400), revocationFailures: 1 }),
      ),
      expected: [
        { type: 'stop-egress', id: 'EG_1', reason: 'revocation-unconfirmed' },
      ],
    });
    assert({
      given: 'a private phase already open with the observer still subscribed',
      should: 'stop the Egress',
      actual: decideBroadcast(
        facts({ egress: active, phase: { kind: 'private' } }),
      ),
      expected: [
        { type: 'stop-egress', id: 'EG_1', reason: 'revocation-unconfirmed' },
      ],
    });
  });
  test('no Egress starts subscribed into a private phase', () => {
    assert({
      given: 'a private phase open and the Egress gone',
      should: 'start one only with its observer already revoked',
      actual: decideBroadcast(
        facts({ phase: { kind: 'private' }, observerSubscribed: false }),
      ),
      expected: [{ type: 'start-egress' }],
    });
    assert({
      given: 'a private phase open, no Egress, observer grant not yet revoked',
      should: 'revoke first and start nothing',
      actual: decideBroadcast(facts({ phase: { kind: 'private' } })),
      expected: [{ type: 'revoke-observer' }],
    });
  });
  test('the observer returns only when the phase is public again', () => {
    assert({
      given: 'a revoked observer, in a private phase and then a public one',
      should: 'keep it revoked, then restore it',
      actual: [
        decideBroadcast(
          facts({
            egress: active,
            phase: { kind: 'private' },
            observerSubscribed: false,
          }),
        ),
        decideBroadcast(facts({ egress: active, observerSubscribed: false })),
      ],
      expected: [[], [{ type: 'restore-observer' }]],
    });
  });
});

describe('ending', () => {
  const ended = {
    roundStatus: 'completed',
    roundEndedAtMs: 90_000,
  } as const;
  test('a terminal Round stops its Egress, which nothing else ends', () => {
    assert({
      given: 'a completed Round and an abandoned Round with an active Egress',
      should: 'stop each',
      actual: [
        decideBroadcast(facts({ ...ended, egress: active })),
        decideBroadcast(
          facts({ ...ended, roundStatus: 'abandoned', egress: active }),
        ),
      ],
      expected: [
        [{ type: 'stop-egress', id: 'EG_1', reason: 'round-ended' }],
        [{ type: 'stop-egress', id: 'EG_1', reason: 'round-ended' }],
      ],
    });
    assert({
      given: 'a terminal Round with no Egress',
      should: 'never start one',
      actual: decideBroadcast(
        facts({ ...ended, egress: { kind: 'complete' } }),
      ),
      expected: [],
    });
  });
  test('completion is final media end plus delay, never the clock alone', () => {
    const over = { ...ended, egress: { kind: 'complete' } } as const;
    assert({
      given: 'no recorded final media end, long after the Round ended',
      should: 'not complete',
      actual: decideBroadcast(facts({ ...over, nowMs: 10_000_000 })),
      expected: [],
    });
    assert({
      given: 'final media released short of its end',
      should: 'not complete, however late it is',
      actual: decideBroadcast(
        facts({
          ...over,
          nowMs: 10_000_000,
          finalMediaEndMs: 90_000,
          releasedThroughMs: 89_999,
        }),
      ),
      expected: [],
    });
    assert({
      given: 'final media released but its delay not yet elapsed',
      should: 'not complete',
      actual: decideBroadcast(
        facts({
          ...over,
          nowMs: 149_999,
          finalMediaEndMs: 90_000,
          releasedThroughMs: 90_000,
        }),
      ),
      expected: [],
    });
    assert({
      given: 'final media released and its delay elapsed',
      should: 'complete',
      actual: decideBroadcast(
        facts({
          ...over,
          nowMs: 150_000,
          finalMediaEndMs: 90_000,
          releasedThroughMs: 90_000,
        }),
      ),
      expected: [{ type: 'complete' }],
    });
  });
  test('stopped and completed Broadcasts do nothing further', () => {
    assert({
      given: 'a stopped Broadcast with a live Egress, and a completed one',
      should: 'stop the Egress once, then nothing',
      actual: [
        decideBroadcast(facts({ stoppedAtMs: 90_000, egress: active })),
        decideBroadcast(facts({ stoppedAtMs: 90_000 })),
        decideBroadcast(facts({ completedAtMs: 90_000, egress: active })),
      ],
      expected: [
        [{ type: 'stop-egress', id: 'EG_1', reason: 'stopped' }],
        [],
        [],
      ],
    });
  });
});
