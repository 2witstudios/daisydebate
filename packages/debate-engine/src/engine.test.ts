import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { restoreDebateRuntime } from './index';
import { create, id, second, startedWorld } from './runtime.test-support';

setupRitewayBun();

describe('ECS adapter contract', () => {
  test('legal lifecycle survives JSON snapshot restoration', async () => {
    const world = startedWorld();
    const snapshot = world.snapshot();
    const restored = restoreDebateRuntime(JSON.parse(JSON.stringify(snapshot)));
    assert({
      given: 'a JSON round trip of a runtime snapshot',
      should: 'restore an equal snapshot',
      actual: restored.snapshot(),
      expected: snapshot,
    });
    restored.transition('completed');
    await assertRejects({
      given: 'a completed restored runtime asked to become active again',
      should: 'refuse with the completed-is-terminal invariant',
      actual: () => restored.transition('active'),
      code: 'INVARIANT',
      invariantId: 'debate.phase.completed.terminal',
    });
    assert({
      given: 'an untouched source runtime',
      should: 'stay in the active phase after the restore round trip',
      actual: world.snapshot().phase,
      expected: 'active',
    });
    world.dispose();
    restored.dispose();
    await assertRejects({
      given: 'a disposed runtime',
      should: 'refuse to read its snapshot as a programming error',
      actual: () => world.snapshot(),
      code: 'INTERNAL',
    });
  });

  test('invalid operations are atomic and enforce role/readiness invariants', async () => {
    const world = create();
    await assertRejects({
      given: 'a participant who never joined marking ready',
      should: 'refuse because the participant must join first',
      actual: () => world.markReady(id),
      code: 'INVARIANT',
      invariantId: 'debate.participant.ready.requires-join',
    });
    await assertRejects({
      given: 'an empty debate asked to start',
      should: 'refuse with the ready-participants invariant',
      actual: () => world.transition('active'),
      code: 'INVARIANT',
      invariantId: 'debate.phase.active.requires-ready-participants',
    });
    world.join({ participantId: id, side: 'affirmative' });
    const before = world.snapshot();
    await assertRejects({
      given: 'a seated participant joining a second side',
      should: 'refuse with the identity uniqueness invariant',
      actual: () => world.join({ participantId: id, side: 'negative' }),
      code: 'INVARIANT',
      invariantId: 'debate.participants.identities-unique',
    });
    await assertRejects({
      given: 'a second participant taking a filled seat',
      should: 'refuse with the seat uniqueness invariant',
      actual: () => world.join({ participantId: second, side: 'affirmative' }),
      code: 'INVARIANT',
      invariantId: 'debate.participants.seats-unique',
    });
    await assertRejects({
      given: 'a waiting debate asked to complete',
      should: 'refuse with the legal transition invariant',
      actual: () => world.transition('completed'),
      code: 'INVARIANT',
      invariantId: 'debate.phase.transition.legal',
    });
    assert({
      given: 'rejected operations',
      should: 'leave the snapshot unchanged',
      actual: world.snapshot(),
      expected: before,
    });
    world.dispose();
  });

  test('rejects a transition that breaks a registered invariant atomically', async () => {
    const world = create();
    const before = world.snapshot();
    await assertRejects({
      given:
        'a transition that would violate the active-phase readiness invariant',
      should: 'identify the registered invariant on the error',
      actual: () => world.transition('active'),
      code: 'INVARIANT',
      invariantId: 'debate.phase.active.requires-ready-participants',
    });
    assert({
      given: 'a transition rejected by a registered invariant',
      should: 'leave the runtime snapshot unchanged',
      actual: world.snapshot(),
      expected: before,
    });
    world.dispose();
  });

  test('rejects duplicate participant identities', async () => {
    const world = create();
    const participant = { id, side: 'affirmative' as const, ready: false };
    await assertRejects({
      given: 'a restored snapshot with duplicate participant identities',
      should: 'identify the participant identity invariant',
      actual: () =>
        restoreDebateRuntime({
          ...world.snapshot(),
          participants: [participant, participant],
        }),
      code: 'INVARIANT',
      invariantId: 'debate.participants.identities-unique',
    });
    world.dispose();
  });

  test('rejects duplicate participant seats', async () => {
    const world = create();
    await assertRejects({
      given: 'a restored snapshot with participants assigned to one seat',
      should: 'identify the participant seat uniqueness invariant',
      actual: () =>
        restoreDebateRuntime({
          ...world.snapshot(),
          participants: [
            { id, side: 'affirmative', ready: false },
            { id: second, side: 'affirmative', ready: false },
          ],
        }),
      code: 'INVARIANT',
      invariantId: 'debate.participants.seats-unique',
    });
    world.dispose();
  });

  test('rejects joining after a debate starts', async () => {
    const world = startedWorld();
    await assertRejects({
      given: 'a join operation after the debate starts',
      should: 'identify the waiting-phase join invariant',
      actual: () =>
        world.join({
          participantId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
          side: 'affirmative',
        }),
      code: 'INVARIANT',
      invariantId: 'debate.participant.join.waiting-phase',
    });
    world.dispose();
  });

  test('rejects readiness changes after a debate starts', async () => {
    const world = startedWorld();
    await assertRejects({
      given: 'a readiness operation after the debate starts',
      should: 'identify the waiting-phase readiness invariant',
      actual: () => world.markReady(id),
      code: 'INVARIANT',
      invariantId: 'debate.participant.ready.waiting-phase',
    });
    world.dispose();
  });

  test('rejects illegal phase transitions', async () => {
    const world = create();
    await assertRejects({
      given: 'a transition that skips the active phase',
      should: 'identify the legal phase transition invariant',
      actual: () => world.transition('completed'),
      code: 'INVARIANT',
      invariantId: 'debate.phase.transition.legal',
    });
    world.dispose();
  });

  test('rejects transitions after completion', async () => {
    const world = startedWorld();
    world.transition('completed');
    await assertRejects({
      given: 'a completed debate and a requested phase transition',
      should: 'identify the completed-is-terminal invariant',
      actual: () => world.transition('active'),
      code: 'INVARIANT',
      invariantId: 'debate.phase.completed.terminal',
    });
    world.dispose();
  });

  test('rejects invalid restored state and unknown snapshot versions', async () => {
    const world = create();
    await assertRejects({
      given: 'a snapshot of an unknown version',
      should: 'refuse it as invalid input',
      actual: () => restoreDebateRuntime({ ...world.snapshot(), version: 2 }),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'an active snapshot with no participants',
      should: 'refuse it with the ready-participants invariant',
      actual: () =>
        restoreDebateRuntime({ ...world.snapshot(), phase: 'active' }),
      code: 'INVARIANT',
      invariantId: 'debate.phase.active.requires-ready-participants',
    });
    const snapshot = world.snapshot();
    snapshot.participants.push({ id, side: 'affirmative', ready: false });
    assert({
      given: 'a caller mutating a returned snapshot',
      should: 'not mutate runtime state',
      actual: world.snapshot().participants,
      expected: [],
    });
    world.dispose();
  });
});
