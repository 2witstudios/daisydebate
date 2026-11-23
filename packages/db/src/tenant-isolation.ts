import type { SQL } from 'bun';
import { query } from './raw-rows';
import { z } from 'zod';
import {
  tenantIsolationManifest,
  type TenantIsolationManifest,
  type TenantKey,
  type TenantSubject,
  type TenantTable,
} from './tenant-isolation-manifest';
import type { TenantDefiner } from './tenant-isolation-manifest';

/**
 * The mechanical check behind tenant isolation: catalog facts about every
 * table in `public`, and a pure function that compares them with the
 * manifest. It runs in an integration test, in `bun doctor` and at
 * production start-up, so a table that carries or references a tenant key
 * cannot ship without its fence.
 */

export type TenantPolicy = {
  readonly name: string;
  readonly command: 'all' | 'select' | 'insert' | 'update';
  /** As PostgreSQL prints it (`pg_get_expr`). */
  readonly using: string | null;
  readonly withCheck: string | null;
};

export const tenantTableFactsRow = z.object({
  table: z.string(),
  rowSecurity: z.boolean(),
  columns: z.array(z.object({ name: z.string(), notNull: z.boolean() })),
  policies: z.array(
    z.object({
      name: z.string(),
      command: z.string(),
      permissive: z.boolean(),
      roles: z.array(z.string()),
      using: z.string().nullable(),
      withCheck: z.string().nullable(),
    }),
  ),
  checks: z.array(z.string()),
  references: z.array(z.string()),
  openGrantees: z.array(z.string()),
});

export type TenantTableFacts = Readonly<z.output<typeof tenantTableFactsRow>>;

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
const historyColumns = [...keyColumns, 'subject_person_user_id'] as const;
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
    history: `(${organizationScope('organization_id')} OR ${lobbyScope('lobby_id')} OR ((subject_person_user_id = daisy_subject_scope()) AND (daisy_organization_scope() IS NULL) AND (daisy_lobby_scope() IS NULL)))`,
  };
  return predicates[entry.key];
};

const guardianSubject =
  '((guardian_user_id = daisy_subject_scope()) OR (minor_user_id = daisy_subject_scope()))';

const subjectPredicates: Record<TenantSubject, string> = {
  user: '(user_id = daisy_subject_scope())',
  'tournament-sponsorship':
    '((sponsor_user_id = daisy_subject_scope()) OR (acted_by_user_id = daisy_subject_scope()))',
  'tournament-capture':
    '((sponsor_user_id = daisy_subject_scope()) OR (official_user_id = daisy_subject_scope()))',
  actor: '(actor_id = daisy_subject_actor_scope())',
  'friend-approval':
    '((child_actor_id = daisy_subject_actor_scope()) OR daisy_is_protection_guardian(child_actor_id))',
  'consent-signer': '(person_user_id = daisy_subject_scope())',
  'child-account-request':
    '((guardian_user_id = daisy_subject_scope()) OR (claimed_user_id = daisy_subject_scope()) OR daisy_owns_guardian_request_email(email) OR daisy_owns_guardian_request_link(requested_link_id))',
  guardian: guardianSubject,
  'lobby-permission': guardianSubject,
  'lobby-waiver': guardianSubject,
};

const activeGuardianLink = `(EXISTS ( SELECT 1
   FROM guardian_links link
  WHERE ((link.id = restriction_lobbies.guardian_link_id) AND (link.status = 'active'::text))))`;
const adultStandingLobby = `(EXISTS ( SELECT 1
   FROM lobbies lobby
  WHERE ((lobby.id = restriction_lobbies.lobby_id) AND (lobby.kind = 'standing'::text) AND (lobby.age_rule = 'adults'::lobby_age_rule) AND (lobby.closed_at IS NULL))))`;
const childLobby =
  '(minor_user_id = daisy_subject_scope()) AND (lobby_id = daisy_lobby_scope())';
const guardianLobby =
  '(guardian_user_id = daisy_subject_scope()) AND (lobby_id = daisy_lobby_scope())';

const lobbyPermissionPolicies: readonly TenantPolicy[] = [
  {
    name: 'restriction_lobbies_request',
    command: 'insert',
    using: null,
    withCheck: `(${childLobby} AND (signed_at IS NULL) AND (waiver_version IS NULL) AND (waiver_digest IS NULL) AND ${activeGuardianLink} AND ${adultStandingLobby})`,
  },
  {
    name: 'restriction_lobbies_sign',
    command: 'update',
    using: `(${guardianLobby} AND (signed_at IS NULL) AND ${activeGuardianLink})`,
    withCheck: `(${guardianLobby} AND (signed_at IS NOT NULL) AND ${adultStandingLobby})`,
  },
];

const lobbyWaiverPolicy: TenantPolicy = {
  name: 'restriction_lobby_waivers_sign',
  command: 'insert',
  using: null,
  withCheck: `(${guardianLobby} AND (EXISTS ( SELECT 1
   FROM (restriction_lobbies permission
     JOIN guardian_links link ON ((link.id = permission.guardian_link_id)))
  WHERE ((permission.guardian_link_id = restriction_lobby_waivers.guardian_link_id) AND (permission.lobby_id = restriction_lobby_waivers.lobby_id) AND (permission.signed_at IS NOT NULL) AND (link.status = 'active'::text)))) AND (EXISTS ( SELECT 1
   FROM seasons season
  WHERE ((season.id = restriction_lobby_waivers.season_id) AND (season.lobby_id = restriction_lobby_waivers.lobby_id) AND (season.status = 'active'::text)))))`,
};

/**
 * The policies a table's manifest entry stands for, from a closed set of
 * shapes: the scope policy (reads and writes need the row's key in scope),
 * a read of the subject's own rows, a counterpart organization's read, and
 * an open read.
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
            command: entry.subjectWrites
              ? ('all' as const)
              : ('select' as const),
            using: subjectPredicates[entry.subject],
            withCheck: entry.subjectWrites
              ? subjectPredicates[entry.subject]
              : null,
          },
        ]),
    ...(entry.subject === 'lobby-permission' ? lobbyPermissionPolicies : []),
    ...(entry.subject === 'lobby-waiver' ? [lobbyWaiverPolicy] : []),
    ...(entry.counterpart === undefined
      ? []
      : [
          {
            name: `${entry.table}_counterpart`,
            command: 'select' as const,
            using: organizationScope(entry.counterpart),
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
      `CREATE POLICY "${policy.name}" ON "${entry.table}" FOR ${policy.command.toUpperCase()}${policy.using === null ? '' : ` USING ${policy.using === 'true' ? '(true)' : policy.using}`}${policy.withCheck === null ? '' : ` WITH CHECK ${policy.withCheck}`};`,
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
    history: [
      ...historyColumns.map((name) => {
        const value = column(name);
        if (!value) return `${entry.table} has no ${name} column`;
        return value.notNull
          ? `${entry.table}.${name} must permit the other history scopes`
          : null;
      }),
      facts.checks.includes(
        'CHECK ((num_nonnulls(organization_id, lobby_id, subject_person_user_id) = 1))',
      )
        ? null
        : `${entry.table} lacks its one-scope CHECK`,
    ],
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
      const carried = historyColumns.filter((name) => names.includes(name));
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
 * tenant fence, its tables' and its definers', read over `client`.
 */
export const readTenantIsolationProblems = async (
  client: SQL,
): Promise<readonly string[]> => [
  ...tenantIsolationProblems(
    await query(client.unsafe(tenantIsolationFactsSql), tenantTableFactsRow),
    tenantIsolationManifest,
  ),
  ...tenantDefinerProblems(
    await query(client.unsafe(tenantDefinerFactsSql), tenantDefinerFactsRow),
    tenantIsolationManifest,
  ),
];

/**
 * Production serves only over a fenced schema: start-up refuses while any
 * tenant-owned table lacks its policies. Reads validated config, so a
 * development server still starts on a schema under change.
 */
export async function refuseUnisolatedTenantTables(app: {
  readonly config: { readonly NODE_ENV: string };
  readonly database: {
    readonly tenantIsolationProblems: (options?: {
      readonly acceptNewerMigrations: boolean;
    }) => Promise<readonly string[]>;
  };
}): Promise<void> {
  if (app.config.NODE_ENV !== 'production') return;
  const problems = await app.database.tenantIsolationProblems({
    acceptNewerMigrations: true,
  });
  if (problems.length > 0)
    throw new Error(
      `Production refuses a schema whose tenant isolation is incomplete: ${problems.join('; ')}`,
    );
}

/**
 * The registered `SECURITY DEFINER` functions of tenant isolation (ADR 0129
 * §4, ADR 0158): catalog facts about every definer outside PostgreSQL's own
 * schemas, and a pure
 * check of them against the manifest's registry. It runs beside the table
 * check, wherever that runs.
 */

export const tenantDefinerFactsRow = z.object({
  name: z.string(),
  source: z.string(),
  config: z.array(z.string()),
  executors: z.array(z.string()),
});

export type TenantDefinerFacts = Readonly<
  z.output<typeof tenantDefinerFactsRow>
>;

/**
 * Plain SQL with no parameters: every `SECURITY DEFINER` function in any
 * schema but PostgreSQL's own, so one outside `public` is checked too.
 */
export const tenantDefinerFactsSql = `
  select
    case when n.nspname = 'public' then p.proname
      else n.nspname || '.' || p.proname end as "name",
    pg_get_functiondef(p.oid) as "source",
    to_json(coalesce(p.proconfig, '{}'::text[])) as "config",
    (select coalesce(json_agg(distinct
        case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end), '[]'::json)
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      where x.privilege_type = 'EXECUTE' and x.grantee <> p.proowner) as "executors"
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg\\_%'
  order by 1
`;

/** Unquoted identifiers fold to lower case, so a name matches in any case. */
const namesTable = (source: string, name: string) =>
  new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(
    source,
  );

/**
 * Its search path starts with `pg_catalog` and ends with `pg_temp`: unlisted,
 * `pg_temp` is searched first, and a caller's temporary table could stand in
 * for one the function names, read with the owner's rights.
 */
const pinsSearchPath = (config: readonly string[]) =>
  config.some((setting) => {
    const [key, value] = setting.split('=');
    if (key !== 'search_path' || value === undefined) return false;
    const schemas = value.split(',').map((schema) => schema.trim());
    // PostgreSQL keeps a schema's first occurrence: pg_temp only at the end.
    return (
      schemas[0] === 'pg_catalog' &&
      schemas.indexOf('pg_temp') === schemas.length - 1
    );
  });

const sameRoles = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join(',') === [...b].sort().join(',');

const definerProblems = (
  entry: TenantDefiner,
  found: readonly TenantDefinerFacts[],
): readonly string[] => {
  if (found.length === 0)
    return [
      `${entry.name} is registered but is not a SECURITY DEFINER function`,
    ];
  return found.flatMap((facts) => [
    ...(pinsSearchPath(facts.config)
      ? []
      : [
          `${entry.name} does not pin its search_path to pg_catalog first and pg_temp last`,
        ]),
    ...(facts.executors.includes('PUBLIC')
      ? [`PUBLIC may execute ${entry.name}`]
      : sameRoles(facts.executors, entry.executors)
        ? []
        : [
            `${entry.name} is executable by ${[...facts.executors].sort().join(', ') || 'nobody'} but registered for ${[...entry.executors].sort().join(', ') || 'nobody'}`,
          ]),
  ]);
};

/**
 * Every way the schema's `SECURITY DEFINER` functions differ from the
 * manifest's registry (ADR 0129 §4, ADR 0158): a definer whose definition
 * names a tenant-owned table reads it past its policies, and one that calls a
 * registered definer reads through it, so either must be registered,
 * pin its search path and be executable by exactly the roles registered.
 * `registeredOnly` checks the registered ones alone, for an image whose
 * database a newer migration may have given functions it cannot name.
 */
export function tenantDefinerProblems(
  facts: readonly TenantDefinerFacts[],
  manifest: TenantIsolationManifest,
  { registeredOnly = false }: { readonly registeredOnly?: boolean } = {},
): readonly string[] {
  const registered = new Set(manifest.definers.map((entry) => entry.name));
  const written = manifest.definers.map((entry) => entry.name);
  // A wrapper of a registered definer crosses tenants as surely as a reader.
  const crossings = [
    ...manifest.tables.map((entry) => entry.table),
    ...registered,
  ];
  return [
    ...[
      ...new Set(
        written.filter((name, index) => written.indexOf(name) !== index),
      ),
    ].map((name) => `${name} is registered more than once`),
    ...manifest.definers.flatMap((entry) =>
      definerProblems(
        entry,
        facts.filter((each) => each.name === entry.name),
      ),
    ),
    ...(registeredOnly
      ? []
      : facts.flatMap((each) => {
          if (registered.has(each.name)) return [];
          const read = crossings.filter((name) =>
            namesTable(each.source, name),
          );
          return read.length === 0
            ? []
            : [
                `${each.name} is a SECURITY DEFINER function reading ${read.join(', ')} but is not registered`,
              ];
        })),
  ];
}
