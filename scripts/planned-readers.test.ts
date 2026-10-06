import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { validatePlannedReaders } from './planned-readers';

setupRitewayBun();

/** Stands in for the gate's index of what each source file really exports. */
const exportNames = new Map([
  ['packages/db/src/schema/role-grants.ts', ['grantRoles', 'roleGrants']],
]);

const knownPaths = new Set([
  'packages/db/src/schema/role-grants.ts',
  'docs/decisions/0057-planned-readers.md',
]);

/** One declaration that satisfies every field, so a test varies only what it is about. */
const declaration = {
  path: 'packages/db/src/schema/role-grants.ts',
  export: 'roleGrants',
  task: 'ID-1',
  owner: 'platform',
  adr: 'docs/decisions/0057-planned-readers.md',
  reason: 'why',
  reviewBy: '2027-01-01',
};

describe('planned readers: a foundation may ship before its reader', () => {
  test('accepts a declaration naming a live task and a review date', () => {
    assert({
      given: 'a registry with one declared planned reader',
      should: 'report no problems',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: 'ID-42',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'Scoped grants land with the org spine.',
              reviewBy: '2027-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: [],
    });
  });

  test('rejects every missing field by name', () => {
    assert({
      given: 'an entry with nothing but a path',
      should: 'name each missing field',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [{ path: 'packages/db/src/schema/role-grants.ts' }],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: [
        'readers[0]: export is required',
        'readers[0]: task is required',
        'readers[0]: owner is required',
        'readers[0]: adr is required',
        'readers[0]: reason is required',
        'readers[0]: reviewBy is required',
      ],
    });
  });

  test('refuses a path that does not exist', () => {
    assert({
      given: 'a declaration for a file that is not in the repository',
      should: 'report the missing path',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/gone.ts',
              export: 'gone',
              task: 'ID-1',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '2027-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: [
        'readers[0]: path does not exist: packages/db/src/schema/gone.ts',
      ],
    });
  });

  test('refuses an ADR that is not a decisions document', () => {
    assert({
      given: 'a reference outside docs/decisions',
      should: 'report the malformed reference',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: 'ID-1',
              owner: 'platform',
              adr: 'docs/architecture/overview.md',
              reason: 'why',
              reviewBy: '2027-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: [
        'readers[0]: invalid ADR reference docs/architecture/overview.md',
      ],
    });
  });

  test('expires a declaration past its review date', () => {
    assert({
      given: 'a declaration whose review date has passed',
      should: 'report it as expired so the gate goes red again',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: 'ID-1',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '2026-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: ['readers[0]: reviewBy has expired: 2026-01-01'],
    });
  });

  test('rejects a malformed review date', () => {
    assert({
      given: 'a reviewBy that is not a UTC calendar day',
      should: 'report the invalid date',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: 'ID-1',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '01/01/2027',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: ['readers[0]: reviewBy must be an ISO date'],
    });
  });

  test('rejects two declarations for the same export', () => {
    assert({
      given: 'the same path and export declared twice',
      should: 'report the duplicate',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: 'ID-1',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '2027-01-01',
            },
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: 'ID-2',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '2027-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: [
        'readers[1]: duplicate packages/db/src/schema/role-grants.ts|roleGrants',
      ],
    });
  });

  test('refuses a wildcard path', () => {
    assert({
      given: 'a declaration covering a whole tree',
      should: 'refuse it, since a reader is one named export',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/*.ts',
              export: 'anything',
              task: 'ID-1',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '2027-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: ['readers[0]: wildcard paths are not allowed'],
    });
  });

  test('reports a bad version and a non-array readers field', () => {
    assert({
      given: 'a registry that is not the expected shape',
      should: 'report each structural problem',
      actual: [
        ...validatePlannedReaders(
          { version: 2, readers: [] },
          { knownPaths, today: '2026-10-06' },
        ),
        ...validatePlannedReaders(
          { version: 1, readers: 'none' },
          { knownPaths, today: '2026-10-06' },
        ),
      ],
      expected: [
        'registry: version must be 1',
        'registry: readers must be an array',
      ],
    });
  });

  test('requires a task id, so a declaration names its future reader', () => {
    assert({
      given: 'a declaration with no task',
      should: 'refuse it: a planned reader must be a committed leaf',
      actual: validatePlannedReaders(
        {
          version: 1,
          readers: [
            {
              path: 'packages/db/src/schema/role-grants.ts',
              export: 'roleGrants',
              task: '',
              owner: 'platform',
              adr: 'docs/decisions/0057-planned-readers.md',
              reason: 'why',
              reviewBy: '2027-01-01',
            },
          ],
        },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: ['readers[0]: task is required'],
    });
  });

  test('refuses a declaration naming an export the file does not have', () => {
    assert({
      given: 'a declaration for a symbol the file never exports',
      should: 'report it, so the registry cannot rot into fiction',
      actual: validatePlannedReaders(
        { version: 1, readers: [{ ...declaration, export: 'madeUpThing' }] },
        {
          knownPaths,
          today: '2026-10-06',
          exportNames,
        },
      ),
      expected: [
        'readers[0]: packages/db/src/schema/role-grants.ts does not export madeUpThing',
      ],
    });
  });

  test('accepts a declaration naming an export the file really has', () => {
    assert({
      given: 'a declaration for a symbol the file exports',
      should: 'report nothing',
      actual: validatePlannedReaders(
        { version: 1, readers: [declaration] },
        {
          knownPaths,
          today: '2026-10-06',
          exportNames,
        },
      ),
      expected: [],
    });
  });

  test('reports a non-object entry instead of crashing the gate', () => {
    assert({
      given: 'entries that are not objects at all',
      should: 'name each one, and never throw',
      actual: [
        ...validatePlannedReaders(
          { version: 1, readers: [null] },
          { knownPaths, today: '2026-10-06' },
        ),
        ...validatePlannedReaders(
          { version: 1, readers: ['nope', 42, [1, 2]] },
          { knownPaths, today: '2026-10-06' },
        ),
      ],
      expected: [
        'readers[0]: entry must be an object',
        'readers[0]: entry must be an object',
        'readers[1]: entry must be an object',
        'readers[2]: entry must be an object',
      ],
    });
  });

  test('skips the export check when the file content is unavailable', () => {
    assert({
      given: 'no export index supplied',
      should: 'fall back to the declaration of intent rather than fail',
      actual: validatePlannedReaders(
        { version: 1, readers: [declaration] },
        { knownPaths, today: '2026-10-06' },
      ),
      expected: [],
    });
  });
});
