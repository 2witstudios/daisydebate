import type {
  TenantDefiner,
  TenantIsolationManifest,
} from './tenant-isolation-manifest';

/**
 * The registered `SECURITY DEFINER` functions of tenant isolation (ADR 0129
 * §4, ADR 0158): catalog facts about every definer in `public`, and a pure
 * check of them against the manifest's registry. It runs beside the table
 * check, wherever that runs.
 */

/** A `SECURITY DEFINER` function in `public`, as the catalog has it. */
export type TenantDefinerFacts = {
  readonly name: string;
  /**
   * Its whole definition (`pg_get_functiondef`), so a `BEGIN ATOMIC` body,
   * which `prosrc` leaves empty, is read too.
   */
  readonly source: string;
  /** Its `SET` clauses (`proconfig`), such as `search_path=pg_catalog, public, pg_temp`. */
  readonly config: readonly string[];
  /** Every role besides its owner that may execute it, `PUBLIC` included. */
  readonly executors: readonly string[];
};

/** Plain SQL with no parameters: every `SECURITY DEFINER` function in `public`. */
export const tenantDefinerFactsSql = `
  select
    p.proname as "name",
    pg_get_functiondef(p.oid) as "source",
    to_json(coalesce(p.proconfig, '{}'::text[])) as "config",
    (select coalesce(json_agg(distinct
        case when x.grantee = 0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end), '[]'::json)
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      where x.privilege_type = 'EXECUTE' and x.grantee <> p.proowner) as "executors"
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  order by p.proname
`;

/** Unquoted identifiers fold to lower case, so a name matches in any case. */
const namesTable = (source: string, table: string) =>
  new RegExp(`\\b${table}\\b`, 'i').test(source);

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
    return schemas[0] === 'pg_catalog' && schemas.at(-1) === 'pg_temp';
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
 * manifest's registry (ADR 0129 §4, ADR 0158): a definer whose body names a
 * tenant-owned table reads it past its policies, so it must be registered,
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
  const owned = manifest.tables.map((entry) => entry.table);
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
          const read = owned.filter((table) => namesTable(each.source, table));
          return read.length === 0
            ? []
            : [
                `${each.name} is a SECURITY DEFINER function reading ${read.join(', ')} but is not registered`,
              ];
        })),
  ];
}
