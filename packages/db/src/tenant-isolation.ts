import {
  tenantIsolationManifest,
  type TenantIsolationManifest,
  type TenantKey,
  type TenantSubject,
  type TenantTable,
} from './tenant-isolation-manifest';

/**
 * The mechanical check behind tenant isolation: catalog facts about every
 * table in `public`, and a pure function that compares them with the
 * manifest. It runs in an integration test, in `bun doctor` and at
 * production start-up, so a table that carries or references a tenant key
 * cannot ship without its fence.
 */

export type TenantPolicy = {
  readonly name: string;
  readonly command: 'all' | 'select';
  /** As PostgreSQL prints it (`pg_get_expr`). */
  readonly using: string;
  readonly withCheck: string | null;
};

type PolicyFacts = {
  readonly name: string;
  /** `pg_policy.polcmd`: `*` all, `r` select, `a` insert, `w` update, `d` delete. */
  readonly command: string;
  readonly permissive: boolean;
  readonly roles: readonly string[];
  readonly using: string | null;
  readonly withCheck: string | null;
};

export type TenantTableFacts = {
  readonly table: string;
  readonly rowSecurity: boolean;
  readonly columns: ReadonlyArray<{
    readonly name: string;
    readonly notNull: boolean;
  }>;
  readonly policies: readonly PolicyFacts[];
  /** Definitions of the validated CHECK constraints. */
  readonly checks: readonly string[];
  /** The tables its foreign keys reference. */
  readonly references: readonly string[];
  /** `PUBLIC` or `daisy_realtime`, where either holds a privilege on it. */
  readonly openGrantees: readonly string[];
};

/** Plain SQL with no parameters, so any client can run it. */
export const tenantIsolationFactsSql = `
  select
    c.relname as "table",
    c.relrowsecurity as "rowSecurity",
    (select coalesce(json_agg(json_build_object(
        'name', a.attname, 'notNull', a.attnotnull) order by a.attnum), '[]'::json)
      from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as "columns",
    (select coalesce(json_agg(json_build_object(
        'name', p.polname,
        'command', p.polcmd,
        'permissive', p.polpermissive,
        'roles', (select coalesce(json_agg(
            case when r.oid = 0 then 'public' else pg_get_userbyid(r.oid) end), '[]'::json)
          from unnest(p.polroles) as r(oid)),
        'using', pg_get_expr(p.polqual, p.polrelid),
        'withCheck', pg_get_expr(p.polwithcheck, p.polrelid)) order by p.polname), '[]'::json)
      from pg_policy p where p.polrelid = c.oid) as "policies",
    (select coalesce(json_agg(pg_get_constraintdef(k.oid) order by k.conname), '[]'::json)
      from pg_constraint k
      where k.conrelid = c.oid and k.contype = 'c' and k.convalidated) as "checks",
    (select coalesce(json_agg(distinct t.relname), '[]'::json)
      from pg_constraint f join pg_class t on t.oid = f.confrelid
      where f.conrelid = c.oid and f.contype = 'f') as "references",
    (select coalesce(json_agg(distinct g.grantee), '[]'::json)
      from (
        select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end as grantee
        from aclexplode(c.relacl) x
        union all
        select case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end
        from pg_attribute a, aclexplode(a.attacl) x
        where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      ) g
      where g.grantee in ('PUBLIC', 'daisy_realtime')) as "openGrantees"
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by c.relname
`;

const keyColumns = ['organization_id', 'lobby_id'] as const;
const retiredKey = 'tournament_id';

const organizationScope = (column: string) =>
  `(${column} = daisy_organization_scope())`;
const lobbyScope = (column: string) => `(${column} = daisy_lobby_scope())`;

const scopePredicate = (entry: TenantTable): string | null => {
  const own = entry.keyColumn;
  const predicates: Record<TenantKey, string | null> = {
    organization: organizationScope(own ?? 'organization_id'),
    lobby: lobbyScope(own ?? 'lobby_id'),
    either: `(${organizationScope('organization_id')} OR ${lobbyScope('lobby_id')})`,
    both: `(${organizationScope('organization_id')} OR ${lobbyScope('lobby_id')})`,
    person: null,
  };
  return predicates[entry.key];
};

const subjectPredicates: Record<TenantSubject, string> = {
  user: '(user_id = daisy_subject_scope())',
  actor: '(actor_id = daisy_subject_actor_scope())',
  guardian:
    '((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()))',
};

/**
 * The policies a table's manifest entry stands for, from a closed set of
 * shapes: the scope policy (reads and writes need the row's key in scope),
 * a read of the subject's own rows, and an open read.
 */
export const tenantPolicies = (entry: TenantTable): readonly TenantPolicy[] => {
  const scope = scopePredicate(entry);
  return [
    ...(scope === null
      ? []
      : [
          {
            name: `${entry.table}_scope`,
            command: 'all' as const,
            using: scope,
            withCheck: scope,
          },
        ]),
    ...(entry.subject === undefined
      ? []
      : [
          {
            name: `${entry.table}_subject`,
            command: 'select' as const,
            using: subjectPredicates[entry.subject],
            withCheck: null,
          },
        ]),
    ...(entry.openRead
      ? [
          {
            name: `${entry.table}_open_read`,
            command: 'select' as const,
            using: 'true',
            withCheck: null,
          },
        ]
      : []),
  ];
};

/** The statements that fence one table, for a migration's author. */
export const tenantPolicyStatements = (
  entry: TenantTable,
): readonly string[] => [
  `ALTER TABLE "${entry.table}" ENABLE ROW LEVEL SECURITY;`,
  ...tenantPolicies(entry).map(
    (policy) =>
      `CREATE POLICY "${policy.name}" ON "${entry.table}" FOR ${policy.command.toUpperCase()} USING ${policy.using === 'true' ? '(true)' : policy.using}${policy.withCheck === null ? '' : ` WITH CHECK ${policy.withCheck}`};`,
  ),
];

const policyCommands: Record<string, string> = {
  '*': 'all',
  r: 'select',
  a: 'insert',
  w: 'update',
  d: 'delete',
};

const describePolicy = (policy: {
  readonly name: string;
  readonly command: string;
  readonly using: string | null;
  readonly withCheck: string | null;
}) =>
  `${policy.name} for ${policy.command} using ${policy.using ?? 'nothing'} with check ${policy.withCheck ?? 'nothing'}`;

const oneTenantKeyCheck =
  'CHECK ((num_nonnulls(organization_id, lobby_id) = 1))';

const keyProblems = (
  entry: TenantTable,
  facts: TenantTableFacts,
): readonly string[] => {
  const column = (name: string) =>
    facts.columns.find((candidate) => candidate.name === name);
  const required = (name: string) => {
    const found = column(name);
    if (found === undefined) return `${entry.table} has no ${name} column`;
    return found.notNull ? null : `${entry.table}.${name} is nullable`;
  };
  const problems: Record<TenantKey, ReadonlyArray<string | null>> = {
    organization: [required(entry.keyColumn ?? 'organization_id')],
    lobby: [required(entry.keyColumn ?? 'lobby_id')],
    both: keyColumns.map(required),
    either: [
      ...keyColumns.map((name) =>
        column(name) === undefined
          ? `${entry.table} has no ${name} column`
          : null,
      ),
      facts.checks.includes(oneTenantKeyCheck)
        ? null
        : `${entry.table} carries a nullable isolation key without the ${entry.table}_one_tenant_key CHECK`,
    ],
    person: [],
  };
  return problems[entry.key].filter(
    (problem): problem is string => problem !== null,
  );
};

const policyProblems = (
  entry: TenantTable,
  facts: TenantTableFacts,
): readonly string[] => {
  if (!facts.rowSecurity)
    return [`${entry.table} does not have row-level security enabled`];
  const expected = tenantPolicies(entry).map(describePolicy).sort();
  const actual = facts.policies
    .map((policy) =>
      policy.permissive &&
      policy.roles.length === 1 &&
      policy.roles[0] === 'public'
        ? describePolicy({
            ...policy,
            command: policyCommands[policy.command] ?? policy.command,
          })
        : `${policy.name} is restrictive or names roles`,
    )
    .sort();
  return [
    ...expected
      .filter((policy) => !actual.includes(policy))
      .map((policy) => `${entry.table} lacks the policy ${policy}`),
    ...actual
      .filter((policy) => !expected.includes(policy))
      .map((policy) => `${entry.table} has an undeclared policy: ${policy}`),
  ];
};

/**
 * Every way the schema's tenant fence differs from the manifest; empty when
 * every table that carries or references a tenant key is fenced as declared.
 */
export function tenantIsolationProblems(
  facts: readonly TenantTableFacts[],
  manifest: TenantIsolationManifest,
): readonly string[] {
  const byName = new Map(facts.map((table) => [table.table, table]));
  const owned = new Map(manifest.tables.map((entry) => [entry.table, entry]));
  const exempt = new Set(manifest.exempt.map((entry) => entry.table));
  // Every entry as written: the map and the set above keep one per table.
  const written = [...manifest.tables, ...manifest.exempt].map(
    (entry) => entry.table,
  );
  const declared = [...owned.keys(), ...exempt];
  return [
    ...[
      ...new Set(
        written.filter((table, index) => written.indexOf(table) !== index),
      ),
    ].map((table) => `${table} is declared more than once`),
    ...[...new Set(declared)]
      .filter((table) => !byName.has(table))
      .map((table) => `${table} is declared but does not exist`),
    ...facts.flatMap((table) => {
      const names = table.columns.map((column) => column.name);
      const retired = names.includes(retiredKey)
        ? [`${table.table} has a ${retiredKey} column: a tournament is a lobby`]
        : [];
      const entry = owned.get(table.table);
      if (entry !== undefined)
        return [
          ...retired,
          ...policyProblems(entry, table),
          ...keyProblems(entry, table),
          ...table.openGrantees.map(
            (grantee) => `${grantee} holds a privilege on ${table.table}`,
          ),
        ];
      if (exempt.has(table.table)) return retired;
      const carried = keyColumns.filter((name) => names.includes(name));
      const referenced = table.references.filter((name) => owned.has(name));
      return [
        ...retired,
        ...(carried.length > 0
          ? [
              `${table.table} carries ${carried.join(' and ')} but is neither tenant-owned nor exempt`,
            ]
          : []),
        ...(carried.length === 0 && referenced.length > 0
          ? [
              `${table.table} references ${referenced.join(', ')} but is neither tenant-owned nor exempt`,
            ]
          : []),
      ];
    }),
  ];
}

/**
 * The check against a live database: every problem with this schema's
 * tenant fence, read through whatever runs one statement.
 */
export const readTenantIsolationProblems = async (
  query: (statement: string) => PromiseLike<unknown>,
): Promise<readonly string[]> =>
  tenantIsolationProblems(
    (await query(tenantIsolationFactsSql)) as readonly TenantTableFacts[],
    tenantIsolationManifest,
  );

/**
 * Production serves only over a fenced schema: start-up refuses while any
 * tenant-owned table lacks its policies. Reads validated config, so a
 * development server still starts on a schema under change.
 */
export async function refuseUnisolatedTenantTables(app: {
  readonly config: { readonly NODE_ENV: string };
  readonly database: {
    readonly tenantIsolationProblems: () => Promise<readonly string[]>;
  };
}): Promise<void> {
  if (app.config.NODE_ENV !== 'production') return;
  const problems = await app.database.tenantIsolationProblems();
  if (problems.length > 0)
    throw new Error(
      `Production refuses a schema whose tenant isolation is incomplete: ${problems.join('; ')}`,
    );
}
