import {
  createDebateRuntime,
  type DebateRuntime,
  type FormatRules,
} from './index';

/** Shared fixtures for the engine suites: deterministic ids and runtimes. */

export const id = 'k2v9x0f4m8q3w1z7c5n6b4d2';
export const second = 'a7b3c9d1e5f2k4m6n8p1r3t5';

export const foundationRules = {
  version: 1 as const,
  seats: { affirmative: 1, negative: 1, judge: 0 },
  clock: { speechMs: 240_000, prepMs: 120_000 },
};

export const soloRules = {
  ...foundationRules,
  seats: { affirmative: 1, negative: 0, judge: 0 },
};

export const create = (
  format = 'foundation',
  rules: FormatRules = foundationRules,
) =>
  createDebateRuntime({
    id,
    resolution: 'A representative resolution',
    createdAt: '2026-01-01T00:00:00.000Z',
    format,
    rules,
  });

/** A foundation runtime with both seats filled, ready and active. */
export const startedWorld = (): DebateRuntime => {
  const world = create();
  world.join({ participantId: id, side: 'affirmative' });
  world.join({ participantId: second, side: 'negative' });
  world.markReady(id);
  world.markReady(second);
  world.transition('active');
  return world;
};
