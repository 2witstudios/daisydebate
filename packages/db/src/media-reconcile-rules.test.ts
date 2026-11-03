import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  MEDIA_RECONCILE_LEASE_MS,
  MEDIA_ROOM_RETIRE_AFTER_MS,
  reconcileClaim,
  reconcileCompletion,
  reconcileLive,
  requireMutationAdmissible,
  requireReconcileLease,
  decideRoom,
} from './media-reconcile-rules';

setupRitewayBun();

const now = new Date('2026-10-22T12:00:00.000Z');
const at = (ms: number) => new Date(now.getTime() + ms);
const idle = {
  reconcileOwner: null,
  reconcileLeaseUntil: null,
  reconcileStartedAt: null,
  reconcileEpoch: 3,
  reconcileRequestVersion: 7,
  unsafeAt: null,
};

test("a reconcile holds the session only while its owner's lease is unexpired", () => {
  assert({
    given: 'no owner, a live lease, a lease ending now and one already past',
    should: 'hold only for the live lease, so an aborted run blocks nothing',
    actual: [
      reconcileLive(idle, now),
      reconcileLive(
        { reconcileOwner: 'worker', reconcileLeaseUntil: at(1) },
        now,
      ),
      reconcileLive(
        { reconcileOwner: 'worker', reconcileLeaseUntil: now },
        now,
      ),
      reconcileLive(
        { reconcileOwner: 'stale', reconcileLeaseUntil: at(-1) },
        now,
      ),
    ],
    expected: [false, true, false, false],
  });
});

test('a reconcile claim waits for a live owner and the minimum interval', () => {
  assert({
    given: 'a live lease, a run started 500ms ago, and one started 501ms ago',
    should:
      'wait for the lease, wait one clock tick past the interval, then claim',
    actual: [
      reconcileClaim(
        { ...idle, reconcileOwner: 'other', reconcileLeaseUntil: at(10) },
        now,
        false,
      ),
      reconcileClaim({ ...idle, reconcileStartedAt: at(-500) }, now, false),
      reconcileClaim({ ...idle, reconcileStartedAt: at(-501) }, now, false)
        .kind,
    ],
    expected: [
      { kind: 'wait', reason: 'lease', retryAt: at(10).toISOString() },
      { kind: 'wait', reason: 'interval', retryAt: at(1).toISOString() },
      'claim',
    ],
  });
});

test('a claim takes the next epoch, a fresh lease and marks unresolved work unsafe', () => {
  const expired = {
    ...idle,
    reconcileOwner: 'stale',
    reconcileLeaseUntil: now,
  };
  assert({
    given: 'an expired owner with and without outstanding vendor mutations',
    should:
      'advance the epoch, run the requested version and set unsafe only for outstanding work',
    actual: [
      reconcileClaim(expired, now, false),
      reconcileClaim(expired, now, true),
      reconcileClaim({ ...idle, unsafeAt: at(-9) }, now, false),
    ].map((claim) => (claim.kind === 'claim' ? claim : null)),
    expected: [
      {
        kind: 'claim',
        epoch: 4,
        leaseUntil: at(MEDIA_RECONCILE_LEASE_MS),
        runningVersion: 7,
        unsafeAt: null,
      },
      {
        kind: 'claim',
        epoch: 4,
        leaseUntil: at(MEDIA_RECONCILE_LEASE_MS),
        runningVersion: 7,
        unsafeAt: now,
      },
      {
        kind: 'claim',
        epoch: 4,
        leaseUntil: at(MEDIA_RECONCILE_LEASE_MS),
        runningVersion: 7,
        unsafeAt: at(-9),
      },
    ],
  });
});

test('only the current owner, epoch and live lease may act', async () => {
  const session = {
    reconcileOwner: 'worker',
    reconcileEpoch: 4,
    reconcileLeaseUntil: at(1),
  };
  const fence = { sessionId: 'session', owner: 'worker', epoch: 4 };
  assert({
    given: 'the owner fence inside its lease',
    should: 'admit the work',
    actual: requireReconcileLease(session, fence, now),
    expected: undefined,
  });
  for (const [label, changed, when] of [
    ['another owner', { ...fence, owner: 'other' }, now],
    ['an older epoch', { ...fence, epoch: 3 }, now],
    ['an expired lease', fence, at(1)],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the stale reconciler',
      actual: () => requireReconcileLease(session, changed, when),
      code: 'CONFLICT',
    });
  await assertRejects({
    given: 'a session without any lease',
    should: 'refuse the reconciler',
    actual: () =>
      requireReconcileLease(
        { ...session, reconcileLeaseUntil: null },
        fence,
        now,
      ),
    code: 'CONFLICT',
  });
});

test('unresolved vendor state admits only teardown mutations', async () => {
  assert({
    given: 'a clean session, and an unsafe or pending one asked to delete',
    should: 'admit every mutation that cannot widen access',
    actual: [
      requireMutationAdmissible({ unsafeAt: null }, 0, 'create'),
      requireMutationAdmissible({ unsafeAt: now }, 0, 'delete'),
      requireMutationAdmissible({ unsafeAt: null }, 1, 'delete'),
    ],
    expected: [undefined, undefined, undefined],
  });
  for (const [unsafeAt, outstanding, kind] of [
    [now, 0, 'create'],
    [null, 2, 'permissions'],
  ] as const)
    await assertRejects({
      given: `an unresolved session asked to ${kind}`,
      should: 'refuse until recovery resolves',
      actual: () => requireMutationAdmissible({ unsafeAt }, outstanding, kind),
      code: 'CONFLICT',
    });
});

test('completion releases the lease and ends only a cleaned terminal session', () => {
  const session = {
    reconcileRunningVersion: 7,
    endedAt: null,
    deletionRequestedAt: null,
    unsafeAt: at(-5),
  };
  const released = {
    reconcileOwner: null,
    reconcileLeaseUntil: null,
    reconcileCompletedAt: now,
    reconcileServedVersion: 7,
    reconcileLastPassClean: true,
  };
  assert({
    given:
      'live uncleaned, terminal uncleaned, terminal cleaned, an already-ended session and a live clean recovery',
    should:
      'serve the version, request deletion when terminal, clear unsafe or end only once cleaned, and end a live unsafe episode with its deletion request (ISSUE-465)',
    actual: [
      reconcileCompletion(session, now, {
        terminal: false,
        unresolved: false,
        decision: { kind: 'keep' },
        clean: true,
      }),
      reconcileCompletion(session, now, {
        terminal: true,
        unresolved: false,
        decision: { kind: 'keep' },
        clean: true,
      }),
      reconcileCompletion(session, now, {
        terminal: true,
        unresolved: false,
        decision: { kind: 'retire', cause: 'absent', uncertain: false },
        clean: true,
      }),
      reconcileCompletion(
        { ...session, endedAt: at(-2), deletionRequestedAt: at(-3) },
        now,
        {
          terminal: true,
          unresolved: false,
          decision: { kind: 'retire', cause: 'absent', uncertain: false },
          clean: true,
        },
      ),
      reconcileCompletion({ ...session, deletionRequestedAt: at(-5) }, now, {
        terminal: false,
        unresolved: false,
        decision: { kind: 'retire', cause: 'absent', uncertain: false },
        clean: true,
      }),
    ],
    expected: [
      { fields: released, result: { safe: false, ended: false } },
      {
        fields: { ...released, deletionRequestedAt: now },
        result: { safe: false, ended: false },
      },
      {
        fields: {
          ...released,
          unsafeAt: null,
          endedAt: now,
          deletionRequestedAt: now,
        },
        result: { safe: true, ended: true },
      },
      {
        fields: {
          ...released,
          unsafeAt: null,
          endedAt: at(-2),
          deletionRequestedAt: at(-3),
        },
        result: { safe: true, ended: true },
      },
      {
        fields: { ...released, unsafeAt: null, deletionRequestedAt: null },
        result: { safe: true, ended: false },
      },
    ],
  });
});

test('a never-unsafe session is safe only without unresolved mutations', () => {
  const session = {
    reconcileRunningVersion: 1,
    endedAt: null,
    deletionRequestedAt: null,
    unsafeAt: null,
  };
  assert({
    given: 'a never-unsafe live session with and without a pending mutation',
    should: 'report safe only when nothing is unresolved',
    actual: [false, true].map(
      (unresolved) =>
        reconcileCompletion(session, now, {
          terminal: false,
          unresolved,
          decision: { kind: 'keep' },
          clean: true,
        }).result,
    ),
    expected: [
      { safe: true, ended: false },
      { safe: false, ended: false },
    ],
  });
});

test('a completion records whether the pass finished its work', () => {
  const session = {
    reconcileRunningVersion: 1,
    endedAt: null,
    deletionRequestedAt: null,
    unsafeAt: null,
  };
  const outcome = {
    terminal: false,
    unresolved: false,
    decision: { kind: 'keep' } as const,
  };
  assert({
    given: 'a pass that did not finish, then one that did',
    should: 'record each on the session for the recovery tick to read',
    actual: [false, true].map(
      (clean) =>
        reconcileCompletion(session, new Date(0), { ...outcome, clean }).fields
          .reconcileLastPassClean,
    ),
    expected: [false, true],
  });
});

test('a room is retired on observed absence, or once uncertainty outlasts the bound', () => {
  const quiet = {
    now,
    terminal: false,
    absenceProven: false,
    unsafeAt: null,
    oldestPendingAt: null,
  };
  const keep = { kind: 'keep' };
  assert({
    given:
      'nothing uncertain; proven absence, sound and uncertain; uncertainty under the bound, at it, and older on the unsafe mark; a terminal session past it, then proven absent',
    should:
      'keep a sound room, retire an absent one at once, wait out a blip, retire a silent one, and hold a terminal session for proof',
    actual: [
      decideRoom(quiet),
      decideRoom({ ...quiet, absenceProven: true }),
      decideRoom({ ...quiet, absenceProven: true, oldestPendingAt: at(-1) }),
      decideRoom({
        ...quiet,
        oldestPendingAt: at(1 - MEDIA_ROOM_RETIRE_AFTER_MS),
      }),
      decideRoom({
        ...quiet,
        oldestPendingAt: at(-MEDIA_ROOM_RETIRE_AFTER_MS),
      }),
      decideRoom({
        ...quiet,
        unsafeAt: at(-MEDIA_ROOM_RETIRE_AFTER_MS),
        oldestPendingAt: at(-1),
      }),
      decideRoom({
        ...quiet,
        terminal: true,
        unsafeAt: at(-MEDIA_ROOM_RETIRE_AFTER_MS),
      }),
      decideRoom({
        ...quiet,
        terminal: true,
        absenceProven: true,
        unsafeAt: at(-1),
      }),
    ],
    expected: [
      keep,
      { kind: 'retire', cause: 'absent', uncertain: false },
      { kind: 'retire', cause: 'absent', uncertain: true },
      keep,
      { kind: 'retire', cause: 'unreachable', uncertain: true },
      { kind: 'retire', cause: 'unreachable', uncertain: true },
      keep,
      { kind: 'retire', cause: 'absent', uncertain: true },
    ],
  });
});
