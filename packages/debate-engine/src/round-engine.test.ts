import { instantMs } from '@daisy/clock';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createRoundRuntime } from './round-runtime';
import { stepRound } from './round-engine';
import type { RoundState } from './round-step';
import {
  emptyCheckpoint,
  hydratedRound,
  lifecycleIn,
  oneOnOneActors,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
} from './runtime.test-support';

setupRitewayBun();

/** A value frozen all the way down, so any write to it throws. */
const deepFrozen = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) deepFrozen(entry);
    Object.freeze(value);
  }
  return value;
};

const openingState = (): RoundState =>
  deepFrozen({
    clock: {
      lifecycle: { status: 'opening' },
      checkpoint: structuredClone(emptyCheckpoint),
      rows: [],
    },
    cast: structuredClone(oneOnOneSeats),
  });

const refusalOf = (run: () => unknown): unknown => {
  try {
    run();
    return 'accepted';
  } catch (error) {
    return error !== null && typeof error === 'object' && 'invariantId' in error
      ? error.invariantId
      : error instanceof Error
        ? error.message
        : 'thrown';
  }
};

describe('stepRound', () => {
  test('an accepted event leaves the state it was given untouched', () => {
    const rules = oneOnOneRules();
    const state = openingState();
    const before = structuredClone(state);
    const at = instantMs(roundAt(0));
    const event = {
      kind: 'activate',
      startedAtMs: at,
      atMs: at + rules.countdownMs,
    } as const;
    const first = stepRound(state, rules, event);
    assert({
      given: 'a deep-frozen opening Round activated past its countdown',
      should:
        'return a new active state with the first segment open, the same every time, and leave the given state as it was',
      actual: {
        status: first.state.clock.lifecycle.status,
        opened: first.changes.filter((change) => change.kind === 'open').length,
        again: stepRound(state, rules, event),
        given: state,
      },
      expected: { status: 'active', opened: 1, again: first, given: before },
    });
  });

  test('a refused event throws its typed refusal and leaves the state untouched', () => {
    const rules = oneOnOneRules();
    const at = instantMs(roundAt(0));
    const active = deepFrozen(
      stepRound(openingState(), rules, {
        kind: 'activate',
        startedAtMs: at,
        atMs: at,
      }).state,
    );
    const before = structuredClone(active);
    assert({
      given: 'a deep-frozen active Round and a speech started with no prep',
      should: 'throw the typed refusal and leave the given state as it was',
      actual: {
        refusal: refusalOf(() =>
          stepRound(active, rules, {
            kind: 'command',
            command: { type: 'start_speech' },
            actorId: oneOnOneActors.affirmative,
            atMs: at + 1,
          }),
        ),
        given: active,
      },
      expected: { refusal: 'round.speech.requires-prep', given: before },
    });
  });
});

describe('createRoundRuntime keeps a step only once it is projected', () => {
  test('an id source that fails leaves the runtime as it was', () => {
    const rules = oneOnOneRules();
    const runtime = createRoundRuntime({
      round: hydratedRound(lifecycleIn('opening'), {
        rules,
        checkpoint: emptyCheckpoint,
        segments: [],
      }),
      rules,
      participants: [...oneOnOneSeats],
      checkpoint: emptyCheckpoint,
      segments: [],
      nextSegmentId: () => {
        throw new Error('no ids left');
      },
    });
    const later = roundAt(rules.countdownMs);
    const before = {
      checkpoint: runtime.checkpoint(),
      position: runtime.position(later),
    };
    const outcome = refusalOf(() =>
      runtime.activate({ at: roundAt(0), now: later }),
    );
    assert({
      given: 'an activation that opens a segment while minting its id throws',
      should: 'throw, and keep the checkpoint and position of before',
      actual: {
        outcome,
        checkpoint: runtime.checkpoint(),
        position: runtime.position(later),
      },
      expected: { outcome: 'no ids left', ...before },
    });
  });
});
