import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createDebateRuntime, restoreDebateRuntime } from './index';

setupRitewayBun();

const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
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
