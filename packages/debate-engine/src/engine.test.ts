import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDebateRuntime, restoreDebateRuntime } from './index';

setupRitewayBun();

const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const second = 'a7b3c9d1e5f2k4m6n8p1r3t5';
const create = () =>
  createDebateRuntime({
    id,
    resolution: 'A representative resolution',
    createdAt: '2026-01-01T00:00:00.000Z',
  });

describe('ECS adapter contract', () => {
  test('legal lifecycle survives JSON snapshot restoration', () => {
    const world = create();
    world.join({ participantId: id, side: 'affirmative' });
    world.join({ participantId: second, side: 'negative' });
    world.markReady(id);
    world.markReady(second);
    world.transition('active');
    const snapshot = world.snapshot();
    const restored = restoreDebateRuntime(JSON.parse(JSON.stringify(snapshot)));
    assert({
      given: 'a JSON round trip of a runtime snapshot',
      should: 'restore an equal snapshot',
      actual: restored.snapshot(),
      expected: snapshot,
    });
    restored.transition('completed');
    expect(() => restored.transition('active')).toThrow();
    assert({
      given: 'an untouched source runtime',
      should: 'stay in the active phase after the restore round trip',
      actual: world.snapshot().phase,
      expected: 'active',
    });
    world.dispose();
    restored.dispose();
    expect(() => world.snapshot()).toThrow();
  });

  test('invalid operations are atomic and enforce role/readiness invariants', () => {
    const world = create();
    expect(() => world.markReady(id)).toThrow();
    expect(() => world.transition('active')).toThrow();
    world.join({ participantId: id, side: 'affirmative' });
    const before = world.snapshot();
    expect(() => world.join({ participantId: id, side: 'negative' })).toThrow();
    expect(() =>
      world.join({ participantId: second, side: 'affirmative' }),
    ).toThrow();
    expect(() => world.transition('completed')).toThrow();
    assert({
      given: 'rejected operations',
      should: 'leave the snapshot unchanged',
      actual: world.snapshot(),
      expected: before,
    });
    world.dispose();
  });

  test('rejects a transition that breaks a registered invariant atomically', () => {
    const world = create();
    const before = world.snapshot();
    let error: unknown;
    try {
      world.transition('active');
    } catch (caught) {
      error = caught;
    }
    assert({
      given:
        'a transition that would violate the active-phase readiness invariant',
      should: 'identify the registered invariant on the error',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.phase.active.requires-ready-participants',
    });
    assert({
      given: 'a transition rejected by a registered invariant',
      should: 'leave the runtime snapshot unchanged',
      actual: world.snapshot(),
      expected: before,
    });
    world.dispose();
  });

  test('rejects duplicate participant identities', () => {
    const world = create();
    const snapshot = world.snapshot();
    const participant = { id, side: 'affirmative' as const, ready: false };

    let error: unknown;
    try {
      restoreDebateRuntime({
        ...snapshot,
        participants: [participant, participant],
      });
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a restored snapshot with duplicate participant identities',
      should: 'identify the participant identity invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.participants.identities-unique',
    });
    world.dispose();
  });

  test('rejects duplicate participant seats', () => {
    const world = create();
    const snapshot = world.snapshot();
    const firstParticipant = {
      id,
      side: 'affirmative' as const,
      ready: false,
    };
    const secondParticipant = {
      id: second,
      side: 'affirmative' as const,
      ready: false,
    };

    let error: unknown;
    try {
      restoreDebateRuntime({
        ...snapshot,
        participants: [firstParticipant, secondParticipant],
      });
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a restored snapshot with participants assigned to one seat',
      should: 'identify the participant seat uniqueness invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.participants.seats-unique',
    });
    world.dispose();
  });

  test('rejects joining after a debate starts', () => {
    const world = create();
    world.join({ participantId: id, side: 'affirmative' });
    world.join({ participantId: second, side: 'negative' });
    world.markReady(id);
    world.markReady(second);
    world.transition('active');

    let error: unknown;
    try {
      world.join({
        participantId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
        side: 'affirmative',
      });
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a join operation after the debate starts',
      should: 'identify the waiting-phase join invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.participant.join.waiting-phase',
    });
    world.dispose();
  });

  test('rejects readiness changes after a debate starts', () => {
    const world = create();
    world.join({ participantId: id, side: 'affirmative' });
    world.join({ participantId: second, side: 'negative' });
    world.markReady(id);
    world.markReady(second);
    world.transition('active');

    let error: unknown;
    try {
      world.markReady(id);
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a readiness operation after the debate starts',
      should: 'identify the waiting-phase readiness invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.participant.ready.waiting-phase',
    });
    world.dispose();
  });

  test('rejects illegal phase transitions', () => {
    const world = create();
    let error: unknown;
    try {
      world.transition('completed');
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a transition that skips the active phase',
      should: 'identify the legal phase transition invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.phase.transition.legal',
    });
    world.dispose();
  });

  test('rejects transitions after completion', () => {
    const world = create();
    world.join({ participantId: id, side: 'affirmative' });
    world.join({ participantId: second, side: 'negative' });
    world.markReady(id);
    world.markReady(second);
    world.transition('active');
    world.transition('completed');

    let error: unknown;
    try {
      world.transition('active');
    } catch (caught) {
      error = caught;
    }

    assert({
      given: 'a completed debate and a requested phase transition',
      should: 'identify the completed-is-terminal invariant',
      actual: (error as { invariantId?: string }).invariantId,
      expected: 'debate.phase.completed.terminal',
    });
    world.dispose();
  });

  test('rejects invalid restored state and unknown snapshot versions', () => {
    const world = create();
    expect(() =>
      restoreDebateRuntime({ ...world.snapshot(), version: 2 }),
    ).toThrow();
    expect(() =>
      restoreDebateRuntime({ ...world.snapshot(), phase: 'active' }),
    ).toThrow();
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
