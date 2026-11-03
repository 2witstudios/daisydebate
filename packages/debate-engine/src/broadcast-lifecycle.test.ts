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
  streamEndedMs: null,
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
  test('an opening Round starts early so it is live before the first speech', () => {
    assert({
      given: 'an opening Round with no Egress',
      should: 'start one',
      actual: decideBroadcast(facts({ roundStatus: 'opening' })),
      expected: [{ type: 'start-egress' }],
    });
  });
});

describe('private phases fail closed', () => {
  const upcoming = (inMs: number) =>
    ({ kind: 'private-at', atMs: 100_000 + inMs }) as const;
  test('a sweep every second revokes before a scheduled speech ends, wherever its passes fall', () => {
    const SWEEP_EVERY_MS = 1000;
    const leadOf = (firstPassMs: number) => {
      for (let inMs = 60_000 - firstPassMs; inMs > 0; inMs -= SWEEP_EVERY_MS)
        if (
          decideBroadcast(
            facts({ egress: active, phase: upcoming(inMs) }),
          ).some((action) => action.type === 'revoke-observer')
        )
          return inMs;
      return 0;
    };
    const offsets = Array.from({ length: 100 }, (_, tenth) => tenth * 10);
    assert({
      given: 'passes one second apart, at every offset from the speech end',
      should: 'revoke with at least a full period still to run',
      actual: Math.min(...offsets.map(leadOf)) >= SWEEP_EVERY_MS,
      expected: true,
    });
  });
  test('the observer is revoked ahead of a scheduled private phase', () => {
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
      given:
        'a private phase opened with no warning, such as prep, observer subscribed',
      should:
        'revoke, not stop: the mic closes by grant, and a stop loses media',
      actual: decideBroadcast(
        facts({ egress: active, phase: { kind: 'private' } }),
      ),
      expected: [{ type: 'revoke-observer' }],
    });
    assert({
      given: 'that revocation having failed',
      should: 'stop the Egress',
      actual: decideBroadcast(
        facts({
          egress: active,
          phase: { kind: 'private' },
          revocationFailures: 1,
        }),
      ),
      expected: [
        { type: 'stop-egress', id: 'EG_1', reason: 'revocation-unconfirmed' },
      ],
    });
  });
  test('a stage that joins as it is revoked is revoked again', () => {
    assert({
      given: 'a private phase, the observer already revoked, the Egress live',
      should: 'say the revocation again on every pass',
      actual: decideBroadcast(
        facts({
          egress: active,
          phase: { kind: 'private' },
          observerSubscribed: false,
        }),
      ),
      expected: [{ type: 'reassert-revocation' }],
    });
    assert({
      given: 'the phase public again, or no Egress at all',
      should: 'not say it',
      actual: [
        decideBroadcast(facts({ egress: active, observerSubscribed: false })),
        decideBroadcast(
          facts({ phase: { kind: 'private' }, observerSubscribed: false }),
        ),
      ].map((actions) => actions.some((a) => a.type === 'reassert-revocation')),
      expected: [false, false],
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
  test('after an unconfirmed stop, revocation is retried and the Round carries on', () => {
    const stopped = { kind: 'complete' } as const;
    assert({
      given:
        'a stopped Egress in a private phase, observer never confirmed revoked',
      should:
        'revoke, which an absent observer confirms, and start nothing subscribed',
      actual: decideBroadcast(
        facts({
          egress: stopped,
          phase: { kind: 'private' },
          revocationFailures: 3,
        }),
      ),
      expected: [{ type: 'revoke-observer' }],
    });
    assert({
      given: 'that revocation confirmed',
      should: 'start a fresh Egress, revoked, so the slate returns',
      actual: decideBroadcast(
        facts({
          egress: stopped,
          phase: { kind: 'private' },
          observerSubscribed: false,
        }),
      ),
      expected: [{ type: 'start-egress' }],
    });
  });
  test('prep before the last speech gives the observer back for that speech', () => {
    assert({
      given: 'a revoked observer and a last speech minutes from its end',
      should: 'restore it: the private phase is not near',
      actual: decideBroadcast(
        facts({
          egress: active,
          observerSubscribed: false,
          phase: { kind: 'private-at', atMs: 100_000 + 60_000 },
        }),
      ),
      expected: [{ type: 'restore-observer' }],
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
      expected: [
        [{ type: 'reassert-revocation' }],
        [{ type: 'restore-observer' }],
      ],
    });
  });
});

describe('ending', () => {
  const ended = {
    roundStatus: 'completed',
    roundEndedAtMs: 90_000,
  } as const;
  test('a Round ending with no live Egress still ends its media', () => {
    assert({
      given: 'a finished Round whose Egress failed, or never started',
      should: 'record the end, so the Broadcast can complete and facts release',
      actual: [
        decideBroadcast(
          facts({
            roundStatus: 'completed',
            roundEndedAtMs: 90_000,
            egress: { kind: 'failed', id: 'EG_1' },
          }),
        ),
        decideBroadcast(
          facts({ roundStatus: 'abandoned', roundEndedAtMs: 90_000 }),
        ),
      ],
      expected: [
        [{ type: 'record-media-ended' }],
        [{ type: 'record-media-ended' }],
      ],
    });
  });
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
      expected: [{ type: 'record-media-ended' }],
    });
  });
  test('completion is final media end plus delay, never the clock alone', () => {
    const over = { ...ended, egress: { kind: 'complete' } } as const;
    assert({
      given: 'no recorded final media end, long after the Round ended',
      should: 'not complete',
      actual: decideBroadcast(facts({ ...over, nowMs: 10_000_000 })),
      expected: [{ type: 'record-media-ended' }],
    });
    assert({
      given: 'final media released short of its end',
      should: 'not complete, however late it is',
      actual: decideBroadcast(
        facts({
          ...over,
          nowMs: 10_000_000,
          finalMediaEndMs: 90_000,
          streamEndedMs: null,
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
          streamEndedMs: 100_000,
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
          streamEndedMs: 100_000,
        }),
      ),
      expected: [{ type: 'complete' }],
    });
  });
  test('stopped and completed Broadcasts do nothing further', () => {
    assert({
      given:
        'a stopped Broadcast with a live Egress, then with none, then with its end recorded, and a completed one',
      should:
        'stop the Egress, record that media ended so the worker can complete it, then nothing',
      actual: [
        decideBroadcast(facts({ stoppedAtMs: 90_000, egress: active })),
        decideBroadcast(facts({ stoppedAtMs: 90_000 })),
        decideBroadcast(
          facts({ stoppedAtMs: 90_000, finalMediaEndMs: 90_000 }),
        ),
        decideBroadcast(facts({ completedAtMs: 90_000, egress: active })),
      ],
      expected: [
        [{ type: 'stop-egress', id: 'EG_1', reason: 'stopped' }],
        [{ type: 'record-media-ended' }],
        [],
        [],
      ],
    });
  });
});
