import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolveFlag } from './resolver';
import type { FlagDefinition, FlagSnapshot, FlagState } from './model';

setupRitewayBun();
const now = Date.parse('2026-11-05T00:00:00Z');
const entry: FlagDefinition = {
  key: 'test-release',
  kind: 'release',
  owner: '@2witstudios',
  taskCode: 'FLAGS-3',
  expiresOn: '2026-12-01',
  safeDefault: false,
  dependencies: [],
};
const snapshot = (
  state: FlagState,
  enabled = true,
  expiresAt = now + 1,
): FlagSnapshot => ({
  kind: 'available',
  flags: [
    { key: entry.key, revision: 1, state, override: { enabled, expiresAt } },
  ],
});

test('resolver precedence and logical expiry', () => {
  const resolve = (facts: FlagSnapshot, key = entry.key) =>
    resolveFlag({ catalogue: [entry], snapshot: facts, key, now });
  assert({
    given: 'unknown, killed, targeted, expired, stored and missing flag states',
    should: 'resolve in order without relying on a sweep',
    actual: [
      resolve(snapshot('enabled'), 'unknown'),
      resolve(snapshot('killed')),
      resolve(snapshot('disabled')),
      resolve(snapshot('enabled', false)),
      resolve(snapshot('enabled', false, now)),
      resolve(snapshot('default', true, now - 1)),
      resolve({ kind: 'available', flags: [] }),
      resolve({ kind: 'unavailable' }),
    ],
    expected: [
      { enabled: false, reason: 'UNKNOWN' },
      { enabled: false, reason: 'DISABLED' },
      { enabled: true, reason: 'TARGETING_MATCH' },
      { enabled: false, reason: 'TARGETING_MATCH' },
      { enabled: true, reason: 'STATIC' },
      { enabled: false, reason: 'DEFAULT' },
      { enabled: false, reason: 'DEFAULT' },
      { enabled: false, reason: 'ERROR' },
    ],
  });
});

test('every dependency must be active and invalid graphs fail closed', () => {
  const dependency = {
    ...entry,
    key: 'dependency',
    safeDefault: true,
    kind: 'ops' as const,
  };
  const root = { ...entry, dependencies: [dependency.key] };
  const resolve = (
    catalogue: readonly FlagDefinition[],
    facts = snapshot('enabled'),
  ) => resolveFlag({ catalogue, snapshot: facts, key: entry.key, now });
  assert({
    given:
      'an active dependency, an inactive dependency, a missing dependency, a cycle and a duplicate key',
    should: 'allow only the valid graph with every dependency active',
    actual: [
      resolve([root, dependency]),
      resolve([root, { ...dependency, safeDefault: false }]),
      resolve([root]),
      resolve([root, { ...dependency, dependencies: [entry.key] }]),
      resolve([entry, entry]),
    ].map((result) => result.enabled),
    expected: [true, false, false, false, false],
  });
});

test('ops safe defaults apply during storage failure, with dependencies', () => {
  const ops: FlagDefinition = { ...entry, kind: 'ops', safeDefault: true };
  assert({
    given: 'an ops safe default, a dependent release and an invalid instant',
    should:
      'respect safe defaults without opening a release or accepting invalid time',
    actual: [
      resolveFlag({
        catalogue: [ops],
        snapshot: { kind: 'unavailable' },
        key: ops.key,
        now,
      }),
      resolveFlag({
        catalogue: [entry],
        snapshot: { kind: 'unavailable' },
        key: entry.key,
        now,
      }),
      resolveFlag({
        catalogue: [ops],
        snapshot: snapshot('enabled'),
        key: ops.key,
        now: NaN,
      }),
    ].map((result) => result.enabled),
    expected: [true, false, false],
  });
});

test('release expiry closes a stored or targeted release even with no policy run', () => {
  const expires = Date.parse(entry.expiresOn) + 86_400_000;
  assert({
    given: 'one instant before release expiry and exactly at expiry',
    should: 'close at the boundary despite a still-live account override',
    actual: [expires - 1, expires].map(
      (instant) =>
        resolveFlag({
          catalogue: [entry],
          snapshot: snapshot('enabled', true, expires + 10),
          key: entry.key,
          now: instant,
        }).enabled,
    ),
    expected: [true, false],
  });
});
