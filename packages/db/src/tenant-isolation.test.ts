import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  refuseUnisolatedTenantTables,
  tenantIsolationProblems,
  tenantPolicies,
  type TenantTableFacts,
} from './tenant-isolation';
import {
  tenantIsolationManifest,
  type TenantIsolationManifest,
  type TenantTable,
} from './tenant-isolation-manifest';

setupRitewayBun();

const commands = { all: '*', select: 'r' } as const;

/** The catalog a correct migration leaves for one manifest entry. */
const fenced = (entry: TenantTable): TenantTableFacts => ({
  table: entry.table,
  rowSecurity: true,
  columns: [
    { name: 'id', notNull: true },
    ...(entry.key === 'person'
      ? []
      : [
          { name: 'organization_id', notNull: entry.key !== 'either' },
          { name: 'lobby_id', notNull: entry.key !== 'either' },
        ]),
  ],
  policies: tenantPolicies(entry).map((policy) => ({
    name: policy.name,
    command: commands[policy.command],
    permissive: true,
    roles: ['public'],
    using: policy.using,
    withCheck: policy.withCheck,
  })),
  checks:
    entry.key === 'either'
      ? ['CHECK ((num_nonnulls(organization_id, lobby_id) = 1))']
      : [],
  references: [],
  openGrantees: [],
});

const plain = (table: string, columns: readonly string[] = ['id']) => ({
  table,
  rowSecurity: false,
  columns: columns.map((name) => ({ name, notNull: true })),
  policies: [],
  checks: [],
  references: [] as string[],
  openGrantees: [],
});

const catalog = (manifest: TenantIsolationManifest) => [
  ...manifest.tables.map(fenced),
  ...manifest.exempt.map(({ table }) => plain(table, ['id', 'lobby_id'])),
  plain('users'),
];

const small: TenantIsolationManifest = {
  tables: [
    { table: 'events', key: 'lobby' },
    { table: 'grants', key: 'either', subject: 'user' },
    { table: 'templates', key: 'organization', openRead: true },
  ],
  exempt: [{ table: 'rooms', reason: 'read by the Room evaluator' }],
};

/** The small catalog with one table's facts replaced. */
const withFault = (
  table: string,
  change: (facts: TenantTableFacts) => TenantTableFacts,
) =>
  tenantIsolationProblems(
    catalog(small).map((facts) =>
      facts.table === table ? change(facts) : facts,
    ),
    small,
  );

describe('tenantIsolationProblems', () => {
  test('is silent on a catalog fenced as the manifest declares', () => {
    assert({
      given: 'every manifest table with its policies and every exempt table',
      should: 'report nothing, for the small manifest and the real one',
      actual: [
        tenantIsolationProblems(catalog(small), small),
        tenantIsolationProblems(
          catalog(tenantIsolationManifest),
          tenantIsolationManifest,
        ),
      ],
      expected: [[], []],
    });
  });

  test('reports a tenant-owned table with no policy or a wrong one', () => {
    assert({
      given:
        'a table without row-level security, one missing a policy, one whose expression differs and one with an extra policy',
      should: 'name each',
      actual: [
        withFault('events', (facts) => ({ ...facts, rowSecurity: false })),
        withFault('grants', (facts) => ({
          ...facts,
          policies: facts.policies.slice(0, 1),
        })),
        withFault('events', (facts) => ({
          ...facts,
          policies: facts.policies.map((policy) => ({
            ...policy,
            using: 'true',
          })),
        })),
        withFault('events', (facts) => ({
          ...facts,
          policies: [
            ...facts.policies,
            {
              name: 'events_everyone',
              command: 'r',
              permissive: true,
              roles: ['public'],
              using: 'true',
              withCheck: null,
            },
          ],
        })),
      ],
      expected: [
        ['events does not have row-level security enabled'],
        [
          'grants lacks the policy grants_subject for select using (user_id = daisy_subject_scope()) with check nothing',
        ],
        [
          'events lacks the policy events_scope for all using (lobby_id = daisy_lobby_scope()) with check (lobby_id = daisy_lobby_scope())',
          'events has an undeclared policy: events_scope for all using true with check (lobby_id = daisy_lobby_scope())',
        ],
        [
          'events has an undeclared policy: events_everyone for select using true with check nothing',
        ],
      ],
    });
  });

  test('reports a table that carries or references a tenant key undeclared', () => {
    assert({
      given:
        'an undeclared table with a lobby_id column, and one with a foreign key to a tenant-owned table',
      should: 'name each as neither tenant-owned nor exempt',
      actual: tenantIsolationProblems(
        [
          ...catalog(small),
          plain('stages', ['id', 'lobby_id']),
          { ...plain('venues'), references: ['events', 'users'] },
        ],
        small,
      ),
      expected: [
        'stages carries lobby_id but is neither tenant-owned nor exempt',
        'venues references events but is neither tenant-owned nor exempt',
      ],
    });
  });

  test('reports a nullable isolation key outside a declared one-of-two CHECK', () => {
    const nullable = (facts: TenantTableFacts) => ({
      ...facts,
      columns: facts.columns.map((column) => ({ ...column, notNull: false })),
    });
    assert({
      given:
        'a lobby-keyed table whose key is nullable, and a one-of-two table without its CHECK',
      should: 'name each',
      actual: [
        withFault('events', nullable),
        withFault('grants', (facts) => ({ ...facts, checks: [] })),
      ],
      expected: [
        ['events.lobby_id is nullable'],
        [
          'grants carries a nullable isolation key without the grants_one_tenant_key CHECK',
        ],
      ],
    });
  });

  test('reports the retired tournament_id key wherever it appears', () => {
    assert({
      given:
        'a tenant-owned, an exempt and an undeclared table with a tournament_id column',
      should: 'name all three',
      actual: tenantIsolationProblems(
        [...catalog(small), plain('venues', ['id', 'tournament_id'])].map(
          (facts) =>
            facts.table === 'venues'
              ? facts
              : facts.table === 'events' || facts.table === 'rooms'
                ? {
                    ...facts,
                    columns: [
                      ...facts.columns,
                      { name: 'tournament_id', notNull: true },
                    ],
                  }
                : facts,
        ),
        small,
      ),
      expected: [
        'events has a tournament_id column: a tournament is a lobby',
        'rooms has a tournament_id column: a tournament is a lobby',
        'venues has a tournament_id column: a tournament is a lobby',
      ],
    });
  });

  test('reports a privilege held by PUBLIC or the realtime role', () => {
    assert({
      given: 'a tenant-owned table daisy_realtime and PUBLIC can read',
      should: 'name both grantees',
      actual: withFault('events', (facts) => ({
        ...facts,
        openGrantees: ['PUBLIC', 'daisy_realtime'],
      })),
      expected: [
        'PUBLIC holds a privilege on events',
        'daisy_realtime holds a privilege on events',
      ],
    });
  });

  test('reports a declaration that names no table, or one table twice', () => {
    assert({
      given:
        'a manifest entry and an exemption for tables that do not exist, and a table both owned and exempt',
      should: 'name each',
      actual: tenantIsolationProblems(catalog(small), {
        tables: [...small.tables, { table: 'venues', key: 'lobby' }],
        exempt: [
          ...small.exempt,
          { table: 'check_ins', reason: 'none' },
          { table: 'events', reason: 'none' },
        ],
      }),
      expected: [
        'events is declared more than once',
        'venues is declared but does not exist',
        'check_ins is declared but does not exist',
      ],
    });
  });
});

const gateOutcome = async (NODE_ENV: string, problems: readonly string[]) => {
  try {
    await refuseUnisolatedTenantTables({
      config: { NODE_ENV },
      database: { tenantIsolationProblems: async () => problems },
    });
    return 'started';
  } catch (error) {
    return (error as Error).message;
  }
};

describe('refuseUnisolatedTenantTables', () => {
  test('refuses production over an unfenced schema and nothing else', async () => {
    assert({
      given:
        'production with a problem, production with none and development with a problem',
      should: 'refuse only the first, naming the problem',
      actual: [
        await gateOutcome('production', ['events lacks a policy']),
        await gateOutcome('production', []),
        await gateOutcome('development', ['events lacks a policy']),
      ],
      expected: [
        'Production refuses a schema whose tenant isolation is incomplete: events lacks a policy',
        'started',
        'started',
      ],
    });
  });
});
