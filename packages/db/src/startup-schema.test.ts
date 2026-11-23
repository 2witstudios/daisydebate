import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { startupSchemaProblems, type ImageSchema } from './startup-schema';
import type { TenantDefinerFacts, TenantTableFacts } from './tenant-isolation';
setupRitewayBun();
const image: ImageSchema = {
  migrations: [{ hash: 'a'.repeat(64), createdAt: 100 }],
  tables: [{ table: 'rooms', columns: ['id', 'title'] }],
};
const facts: readonly TenantTableFacts[] = [
  {
    table: 'rooms',
    rowSecurity: false,
    columns: [
      { name: 'id', notNull: true },
      { name: 'title', notNull: true },
    ],
    policies: [],
    checks: [],
    references: [],
    openGrantees: [],
  },
];
const manifest = {
  tables: [],
  exempt: [{ table: 'rooms', reason: 'Room evaluator' }],
  definers: [],
};
const definers: readonly TenantDefinerFacts[] = [];
const journal = [...image.migrations, { hash: 'b'.repeat(64), createdAt: 200 }];
describe('startupSchemaProblems', () => {
  test('accepts additions only after a complete matching image migration prefix', () => {
    const addition = {
      ...facts[0]!,
      table: 'venues',
      columns: [{ name: 'lobby_id', notNull: true }],
    };
    assert({
      given: 'a newer committed migration and unused added table/column',
      should:
        'start the older image, but reject the same undeclared table without the newer history',
      actual: [
        startupSchemaProblems({
          image,
          journal,
          facts: [...facts, addition],
          definers,
          manifest,
        }),
        startupSchemaProblems({
          image,
          journal: image.migrations,
          facts: [...facts, addition],
          definers,
          manifest,
        }),
      ],
      expected: [
        [],
        ['venues carries lobby_id but is neither tenant-owned nor exempt'],
      ],
    });
  });
  test('allows a later folder to repeat SQL without repeating its migration identity', () => {
    assert({
      given: 'different migration instants with identical SQL hashes',
      should: 'accept the intact forward history',
      actual: startupSchemaProblems({
        image,
        journal: [
          ...image.migrations,
          { ...image.migrations[0]!, createdAt: 200 },
        ],
        facts,
        definers,
        manifest,
      }),
      expected: [],
    });
  });
  test('refuses incomplete or divergent migration history', () => {
    assert({
      given: 'missing, rewritten, duplicate, or out-of-order journal entries',
      should: 'refuse every inconsistent history',
      actual: [
        [],
        [{ hash: 'c'.repeat(64), createdAt: 100 }],
        [...journal, journal[1]!],
        [journal[1]!, journal[0]!],
      ].map(
        (journal) =>
          startupSchemaProblems({ image, journal, facts, definers, manifest })
            .length > 0,
      ),
      expected: [true, true, true, true],
    });
  });
  test('never lets a newer history excuse missing image tables or columns', () => {
    assert({
      given: 'a database ahead with a missing used table or column',
      should: 'refuse both',
      actual: [
        [],
        [{ ...facts[0]!, columns: [{ name: 'id', notNull: true }] }],
      ].map((facts) =>
        startupSchemaProblems({ image, journal, facts, definers, manifest }),
      ),
      expected: [
        [
          'rooms is required by this image but does not exist',
          'rooms is declared but does not exist',
        ],
        ['rooms.title is required by this image but does not exist'],
      ],
    });
  });
  test('retains every known tenant fence refusal even when history is newer', () => {
    assert({
      given: 'a known tenant table with disabled RLS on a newer database',
      should: 'refuse the broken fence',
      actual: startupSchemaProblems({
        image,
        journal,
        facts,
        definers,
        manifest: {
          tables: [{ table: 'rooms', key: 'person' }],
          exempt: [],
          definers: [],
        },
      }),
      expected: ['rooms does not have row-level security enabled'],
    });
  });
  test('lets a newer history add a definer this image cannot name, never weaken a registered one', () => {
    const owned = {
      tables: [{ table: 'grants', key: 'person' as const }],
      exempt: manifest.exempt,
      definers: [
        { name: 'daisy_known', executors: ['daisy_web'], reason: 'known' },
      ],
    };
    const grants = { ...facts[0]!, table: 'grants', rowSecurity: true };
    const known = {
      name: 'daisy_known',
      source: 'select 1 from grants',
      config: ['search_path=pg_catalog, public, pg_temp'],
      executors: ['daisy_web'],
    };
    const later = { ...known, name: 'daisy_later' };
    const ask = (
      journal: readonly { hash: string; createdAt: number }[],
      found: readonly TenantDefinerFacts[],
    ) =>
      startupSchemaProblems({
        image: {
          ...image,
          tables: [...image.tables, { table: 'grants', columns: ['id'] }],
        },
        journal,
        facts: [...facts, grants],
        definers: found,
        manifest: owned,
      });
    assert({
      given:
        'an unregistered definer reading a tenant table, on a newer and on an equal history, and a registered one PUBLIC may run on a newer one',
      should:
        'accept the first, refuse the second, and refuse the weakened registered one',
      actual: [
        ask(journal, [known, later]),
        ask(image.migrations, [known, later]),
        ask(journal, [{ ...known, executors: ['PUBLIC', 'daisy_web'] }]),
      ],
      expected: [
        [],
        [
          'daisy_later is a SECURITY DEFINER function reading grants but is not registered',
        ],
        ['PUBLIC may execute daisy_known'],
      ],
    });
  });
});
