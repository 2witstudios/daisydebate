import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  auditScope,
  auditCommand,
  documentedOverrides,
  flattenOverrides,
  overrideProblems,
  liveAdvisories,
  liveAuditProblems,
  validateAuditExceptions,
  type AuditException,
} from './audit';
import committed from '../policy/audit-exceptions.json';

setupRitewayBun();

const adr = 'docs/decisions/0039-dated-dependency-audit-exceptions.md';
const entry = (overrides: Partial<AuditException> = {}): AuditException => ({
  advisory: 'GHSA-82fw-gwwq-j7x9',
  packages: ['@vitest/mocker', 'vitest'],
  dependencyPath: 'riteway > vitest > @vitest/mocker',
  reason: 'dev-only test runner dependency',
  unreachable: 'the riteway/vitest entry is never loaded',
  owner: 'platform',
  adr,
  reviewBy: '2026-12-23',
  ...overrides,
});
const registry = (...advisories: readonly unknown[]) => ({
  version: 1,
  advisories,
});
const live = new Map([['GHSA-82fw-gwwq-j7x9', ['@vitest/mocker', 'vitest']]]);
const options = { today: '2026-09-23', knownPaths: new Set([adr]), live };

describe('audit scope', () => {
  const live = (changed: readonly string[] | undefined, forced = false) =>
    auditScope({ forced, changed }).live;
  test('a branch asks the advisory database only when it changed a dependency input', () => {
    assert({
      given:
        'a branch that touched source only, then the lockfile, a workspace manifest, the exception registry and the audit itself',
      should: 'ask the live database for the dependency inputs alone',
      actual: [
        live(['apps/web/src/app/page.tsx', 'docs/dependencies.md']),
        live(['bun.lock']),
        live(['packages/db/package.json']),
        live(['policy/audit-exceptions.json']),
        live(['scripts/audit.ts']),
        live(['apps/web/src/package.json.ts']),
      ],
      expected: [false, true, true, true, true, false],
    });
  });
  test('the nightly run and an incomparable checkout are always audited', () => {
    assert({
      given:
        'the scheduled run with no change, and a checkout that cannot be compared with main',
      should:
        'ask the live database, so main is audited nightly and nothing is skipped by accident',
      actual: [live([], true), live(undefined)],
      expected: [true, true],
    });
  });
});

describe('audit command', () => {
  test('the committed registry ignores nothing', () => {
    assert({
      given: 'the committed audit exception registry, every advisory fixed',
      should: 'run plain bun audit with no --ignore and no --audit-level',
      actual: auditCommand(committed),
      expected: ['bun', 'audit'],
    });
  });

  test('an empty registry audits with no ignores', () => {
    assert({
      given: 'a registry with no advisories',
      should: 'run plain bun audit',
      actual: auditCommand(registry()),
      expected: ['bun', 'audit'],
    });
  });
});

describe('live advisories', () => {
  test('groups bun audit --json packages by GHSA id', () => {
    assert({
      given: 'bun audit --json output with one advisory on two packages',
      should: 'map the GHSA id to its sorted package names',
      actual: [
        ...liveAdvisories({
          vitest: [
            { url: 'https://github.com/advisories/GHSA-82fw-gwwq-j7x9' },
          ],
          '@vitest/mocker': [
            { url: 'https://github.com/advisories/GHSA-82fw-gwwq-j7x9' },
          ],
          underscore: [
            { url: 'https://github.com/advisories/GHSA-qpx9-hpmf-5gmw' },
          ],
        }),
      ],
      expected: [
        ['GHSA-82fw-gwwq-j7x9', ['@vitest/mocker', 'vitest']],
        ['GHSA-qpx9-hpmf-5gmw', ['underscore']],
      ],
    });
  });

  test('a clean audit has no live advisories', () => {
    assert({
      given: 'bun audit --json output for a clean tree',
      should: 'return an empty map',
      actual: liveAdvisories({}).size,
      expected: 0,
    });
  });
});

describe('audit exception registry', () => {
  test('accepts the committed, empty registry against a clean audit', () => {
    assert({
      given: 'the committed registry and no live advisories',
      should: 'report no problems',
      actual: validateAuditExceptions(committed, {
        today: '2026-11-18',
        knownPaths: new Set(),
        live: new Map(),
      }),
      expected: [],
    });
  });

  test('accepts a complete, dated entry that matches a live advisory', () => {
    assert({
      given: 'one well-formed entry whose advisory and packages are live',
      should: 'report no problems',
      actual: validateAuditExceptions(registry(entry()), options),
      expected: [],
    });
  });

  test('fails an entry past its review-by date', () => {
    assert({
      given: 'an entry reviewed by yesterday',
      should: 'report the expired review date',
      actual: validateAuditExceptions(
        registry(entry({ reviewBy: '2026-09-22' })),
        options,
      ),
      expected: ['audit[0]: reviewBy has expired: 2026-09-22'],
    });
  });

  test('fails an entry that no longer matches a live advisory', () => {
    assert({
      given: 'an entry whose advisory bun audit no longer reports',
      should: 'report it as stale so it is removed',
      actual: validateAuditExceptions(
        registry(entry({ advisory: 'GHSA-qpx9-hpmf-5gmw', packages: ['x'] })),
        options,
      ),
      expected: [
        'audit[0]: GHSA-qpx9-hpmf-5gmw no longer matches a live advisory; remove the exception',
      ],
    });
  });

  test('fails an entry whose advisory now reaches another package', () => {
    assert({
      given: 'a live advisory that also affects a package the entry omits',
      should: 'report the package mismatch instead of silently ignoring it',
      actual: validateAuditExceptions(
        registry(entry({ packages: ['vitest'] })),
        options,
      ),
      expected: [
        'audit[0]: GHSA-82fw-gwwq-j7x9 affects @vitest/mocker, vitest, but the exception lists vitest',
      ],
    });
  });

  test('requires every documenting field and a GHSA id', () => {
    assert({
      given: 'an entry with blank fields and a non-GHSA advisory id',
      should: 'report each problem',
      actual: validateAuditExceptions(
        registry({ advisory: '1193684', packages: [], owner: ' ' }),
        { ...options, live: undefined },
      ),
      expected: [
        'audit[0]: dependencyPath is required',
        'audit[0]: reason is required',
        'audit[0]: unreachable is required',
        'audit[0]: owner is required',
        'audit[0]: adr is required',
        'audit[0]: reviewBy is required',
        'audit[0]: advisory must be a GHSA id, got 1193684',
        'audit[0]: packages must list at least one package name',
      ],
    });
  });

  test('rejects unknown ADRs and duplicate advisories', () => {
    assert({
      given: 'two entries for one advisory citing a missing ADR',
      should: 'report the missing ADR and the duplicate',
      actual: validateAuditExceptions(
        registry(
          entry({ adr: 'docs/decisions/9999-missing.md' }),
          entry({ adr: 'docs/decisions/9999-missing.md' }),
        ),
        options,
      ),
      expected: [
        'audit[0]: ADR does not exist: docs/decisions/9999-missing.md',
        'audit[1]: ADR does not exist: docs/decisions/9999-missing.md',
        'audit[1]: duplicate advisory GHSA-82fw-gwwq-j7x9',
      ],
    });
  });

  test('rejects a malformed registry', () => {
    assert({
      given: 'a registry with the wrong version and no advisories array',
      should: 'report both',
      actual: validateAuditExceptions({ version: 2 }, options),
      expected: [
        'audit: version must be 1',
        'audit: advisories must be an array',
      ],
    });
  });
});

describe('audit policy check', () => {
  const auditJson = JSON.stringify({
    vitest: [{ url: 'https://github.com/advisories/GHSA-82fw-gwwq-j7x9' }],
    '@vitest/mocker': [
      { url: 'https://github.com/advisories/GHSA-82fw-gwwq-j7x9' },
    ],
  });
  const checkOptions = { today: options.today, knownPaths: options.knownPaths };

  test('validates the registry against the advisories bun audit printed', () => {
    assert({
      given: 'bun audit --json exiting 1 with the listed advisory in stdout',
      should: 'parse the output and report no problems',
      actual: liveAuditProblems(
        registry(entry()),
        { stdout: auditJson, exitCode: 1 },
        checkOptions,
      ),
      expected: [],
    });
  });

  test('a stale entry fails against a clean audit', () => {
    assert({
      given: 'bun audit --json printing {} for a clean tree',
      should: 'report the entry as stale',
      actual: liveAuditProblems(
        registry(entry()),
        { stdout: '{}', exitCode: 0 },
        checkOptions,
      ),
      expected: [
        'audit[0]: GHSA-82fw-gwwq-j7x9 no longer matches a live advisory; remove the exception',
      ],
    });
  });

  test('unreadable audit output fails instead of passing', () => {
    assert({
      given: 'bun audit --json exiting 1 with no JSON (registry unreachable)',
      should: 'still check the registry offline and report the failed read',
      actual: liveAuditProblems(
        registry(entry({ reviewBy: '2026-09-22' })),
        { stdout: 'error: ConnectionRefused', exitCode: 1 },
        checkOptions,
      ),
      expected: [
        'audit[0]: reviewBy has expired: 2026-09-22',
        'audit: could not read live advisories (bun audit --json exited 1)',
      ],
    });
  });

  test('JSON that is not an advisory map fails instead of passing', () => {
    assert({
      given: 'bun audit --json printing null',
      should: 'report the failed read',
      actual: liveAuditProblems(
        registry(entry()),
        { stdout: 'null', exitCode: 0 },
        checkOptions,
      ),
      expected: [
        'audit: could not read live advisories (bun audit --json exited 0)',
      ],
    });
  });
});

const overridesDoc = (...rows: readonly string[]) =>
  [
    '### Security overrides',
    '',
    '| Override | Clears | Notes |',
    '| --- | --- | --- |',
    ...rows,
    '',
    'Prose after the table.',
  ].join('\n');

describe('security overrides record', () => {
  test('flattens root and parent-scoped overrides', () => {
    assert({
      given: 'a root pin and a parent-scoped pin',
      should: 'name each as package@version, the scoped one under its parent',
      actual: flattenOverrides({
        vitest: '4.1.12',
        jsonpath: { underscore: '1.13.8' },
      }),
      expected: ['vitest@4.1.12', 'jsonpath > underscore@1.13.8'],
    });
  });

  test('reads the documented overrides from the table', () => {
    assert({
      given: 'a Security overrides table with a root and a scoped row',
      should: 'read each first cell as the same flattened pin',
      actual: documentedOverrides(
        overridesDoc(
          '| `vitest` → `4.1.12` | GHSA | note |',
          '| `jsonpath` → `underscore` `1.13.8` | GHSA | note |',
        ),
      ),
      expected: ['vitest@4.1.12', 'jsonpath > underscore@1.13.8'],
    });
  });

  test('a documented pin set matching package.json passes', () => {
    assert({
      given: 'overrides that the table records exactly',
      should: 'report no problems',
      actual: overrideProblems(
        { jsonpath: { underscore: '1.13.8' } },
        overridesDoc('| `jsonpath` → `underscore` `1.13.8` | GHSA | note |'),
      ),
      expected: [],
    });
  });

  test('an undocumented override and a stale row both fail', () => {
    assert({
      given: 'a pin the table omits and a row whose version moved',
      should: 'name the undocumented pin and the stale row',
      actual: overrideProblems(
        { vitest: '4.1.13' },
        overridesDoc('| `vitest` → `4.1.12` | GHSA | note |'),
      ),
      expected: [
        'overrides: vitest@4.1.13 is not in docs/dependencies.md § Security overrides',
        'overrides: docs/dependencies.md lists vitest@4.1.12, which package.json overrides does not pin',
      ],
    });
  });

  test('the committed overrides are all documented', async () => {
    const manifest = (await Bun.file(
      new URL('../package.json', import.meta.url),
    ).json()) as { readonly overrides?: unknown };
    assert({
      given: 'the committed package.json and docs/dependencies.md',
      should: 'report no problems',
      actual: overrideProblems(
        manifest.overrides,
        await Bun.file(
          new URL('../docs/dependencies.md', import.meta.url),
        ).text(),
      ),
      expected: [],
    });
  });
});
