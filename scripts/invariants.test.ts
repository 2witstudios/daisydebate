import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  checkInvariantSpec,
  runInvariantChecks,
  type InvariantSpec,
} from './invariants';

setupRitewayBun();

const spec: InvariantSpec = {
  version: 1,
  invariants: [
    {
      id: 'one',
      check: 'first',
      testReference: { path: 'tests/example.test.ts', name: 'first test' },
    },
  ],
};

describe('invariant specification', () => {
  test('rejects registry, check, and test-reference drift', () => {
    assert({
      given: 'a specification whose registry and references do not match',
      should: 'report every contract mismatch without executing checks',
      actual: checkInvariantSpec(
        {
          ...spec,
          invariants: [
            ...spec.invariants,
            {
              id: 'two',
              check: 'missing',
              testReference: {
                path: 'tests/missing.test.ts',
                name: 'missing test',
              },
            },
          ],
        },
        ['one', 'three'],
        { 'tests/example.test.ts': 'one first test' },
      ),
      expected: [
        'check: first has no registered fixture',
        'check: missing has no registered fixture',
        'registry: missing spec entry for three',
        'registry: unknown spec entry two',
        'test-reference: tests/missing.test.ts is unavailable',
      ],
    });
  });

  test('rejects a reference whose test name or invariant assertion is absent', () => {
    assert({
      given: 'a spec entry pointing at source without its test contract',
      should: 'report both missing reference parts',
      actual: checkInvariantSpec(
        {
          ...spec,
          invariants: [
            {
              ...spec.invariants[0],
              testReference: {
                path: 'tests/example.test.ts',
                name: 'missing test',
              },
            },
          ],
        },
        ['one'],
        { 'tests/example.test.ts': 'unrelated source' },
      ),
      expected: [
        'check: first has no registered fixture',
        'test-reference: missing test is absent from tests/example.test.ts',
        'test-reference: one is absent from tests/example.test.ts',
      ],
    });
  });
});

describe('invariant fixture runner', () => {
  test('executes every registered fixture and returns stable results', () => {
    const registeredSpec: InvariantSpec = {
      version: 1,
      invariants: [
        {
          id: 'debate.phase.active.requires-ready-participants',
          check: 'active-requires-ready-participants',
          testReference: {
            path: 'packages/debate-engine/src/engine.test.ts',
            name: 'rejects a transition that breaks a registered invariant atomically',
          },
        },
      ],
    };

    assert({
      given: 'a registered invariant with a deterministic fixture',
      should: 'return a passing result for the fixture and its expected ID',
      actual: runInvariantChecks(registeredSpec, [
        'debate.phase.active.requires-ready-participants',
      ]),
      expected: {
        ok: true,
        issues: [],
        results: [
          {
            id: 'debate.phase.active.requires-ready-participants',
            status: 'pass',
            detail: 'active-requires-ready-participants',
          },
        ],
      },
    });
  });
});
