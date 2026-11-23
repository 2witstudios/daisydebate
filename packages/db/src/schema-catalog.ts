import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { query } from './raw-rows';
import type { Tx } from './tx';

/**
 * A database's schema as PostgreSQL's catalog records it, one entry per
 * object, keyed by kind and qualified name. Two databases hold the same
 * schema exactly when their catalogs are equal. The value is the object's
 * definition as canonical JSON text, so a difference names the object.
 *
 * It covers what this schema's migrations create: schemas, extensions, types,
 * tables and their columns, constraints, indexes, sequences, views,
 * functions, triggers, rules, policies, every privilege (schema, relation,
 * column, sequence, function, type, default privileges), comments,
 * owners, and the roles any of those name, with their attributes and
 * memberships. Objects an extension owns are the extension's. Row contents,
 * sequence positions and object identifiers are not schema and are not read;
 * neither is the database object itself (its name, encoding, CONNECT grants
 * and settings), which the operator provisions and no migration writes.
 * Not read, because no migration here creates them: aggregate definitions
 * (an aggregate is keyed, its body is not), statistics objects, collations,
 * operators and operator classes, casts, text-search objects and attribute
 * options. A migration that adds one adds its read here first.
 */
export type SchemaCatalog = ReadonlyMap<string, string>;

export type CatalogDifference =
  | { readonly kind: 'missing'; readonly key: string }
  | { readonly kind: 'unexpected'; readonly key: string }
  | {
      readonly kind: 'changed';
      readonly key: string;
      readonly expected: string;
      readonly actual: string;
    };

/** Every entry `actual` lacks, adds or defines differently from `expected`. */
export const catalogDifferences = (
  expected: SchemaCatalog,
  actual: SchemaCatalog,
): readonly CatalogDifference[] =>
  [...new Set([...expected.keys(), ...actual.keys()])]
    .sort()
    .flatMap((key): CatalogDifference[] => {
      const want = expected.get(key);
      const found = actual.get(key);
      if (want === undefined) return [{ kind: 'unexpected', key }];
      if (found === undefined) return [{ kind: 'missing', key }];
      return want === found
        ? []
        : [{ kind: 'changed', key, expected: want, actual: found }];
    });

/** One line per difference, for a refusal or a failed proof. */
export const describeCatalogDifference = (
  difference: CatalogDifference,
): string =>
  difference.kind === 'changed'
    ? `changed ${difference.key}: expected ${difference.expected}, found ${difference.actual}`
    : `${difference.kind} ${difference.key}`;

/** Schemas PostgreSQL itself owns; nothing a migration writes lives there. */
const userNamespace = (alias: string) =>
  sql.raw(
    `${alias}.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
   and ${alias}.nspname not like 'pg_temp_%' and ${alias}.nspname not like 'pg_toast_temp_%'`,
  );

/** Not a member of an extension: the extension entry covers it. */
const notExtensionMember = (catalog: string, oid: string) =>
  sql.raw(
    `not exists (select 1 from pg_depend d where d.classid = '${catalog}'::regclass
     and d.objid = ${oid} and d.deptype = 'e')`,
  );

/** An ACL's items in a stable order: grant order is history, not schema. */
const sortedAcl = (column: string) =>
  sql.raw(
    `(select array_agg(item::text order by item::text) from unnest(${column}) item)`,
  );

const entry = z.object({ key: z.string(), value: z.string() });

/**
 * Each statement yields `key` and `value`, where `value` is `jsonb` cast to
 * text (jsonb orders object keys, so equal definitions print equal text).
 */
const catalogReads = (): readonly SQL[] => [
  sql`select 'schema ' || n.nspname as key, jsonb_build_object(
        'owner', pg_get_userbyid(n.nspowner),
        'acl', ${sortedAcl('n.nspacl')},
        'comment', obj_description(n.oid, 'pg_namespace'))::text as value
      from pg_namespace n where ${userNamespace('n')}`,
  sql`select 'extension ' || e.extname as key, jsonb_build_object(
        'schema', n.nspname, 'version', e.extversion,
        'comment', obj_description(e.oid, 'pg_extension'))::text as value
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace`,
  sql`select 'type ' || n.nspname || '.' || t.typname as key, jsonb_build_object(
        'kind', t.typtype,
        'owner', pg_get_userbyid(t.typowner),
        'acl', ${sortedAcl('t.typacl')},
        'labels', (select array_agg(e.enumlabel order by e.enumsortorder)
                   from pg_enum e where e.enumtypid = t.oid),
        'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
        'notNull', t.typnotnull,
        'default', t.typdefault,
        'checks', (select array_agg(pg_get_constraintdef(c.oid) || ' ' || c.conname order by c.conname)
                   from pg_constraint c where c.contypid = t.oid),
        'attributes', case when t.typtype = 'c' then (
          select array_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) order by a.attnum)
          from pg_attribute a where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) end,
        'range', (select format_type(r.rngsubtype, null) from pg_range r where r.rngtypid = t.oid),
        'comment', obj_description(t.oid, 'pg_type'))::text as value
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where ${userNamespace('n')} and ${notExtensionMember('pg_type', 't.oid')}
        and (t.typtype in ('e', 'd', 'r', 'm')
             or (t.typtype = 'c' and exists (
               select 1 from pg_class c where c.oid = t.typrelid and c.relkind = 'c')))`,
  sql`select 'relation ' || n.nspname || '.' || c.relname as key, jsonb_build_object(
        'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'acl', ${sortedAcl('c.relacl')},
        'persistence', c.relpersistence,
        'rowSecurity', c.relrowsecurity,
        'forceRowSecurity', c.relforcerowsecurity,
        'options', c.reloptions,
        'partitionKey', case when c.relkind = 'p' then pg_get_partkeydef(c.oid) end,
        'partitionOf', (select i.inhparent::regclass::text from pg_inherits i where i.inhrelid = c.oid),
        'partitionBound', pg_get_expr(c.relpartbound, c.oid),
        'replicaIdentity', c.relreplident,
        'view', case when c.relkind in ('v', 'm') then pg_get_viewdef(c.oid) end,
        'comment', obj_description(c.oid, 'pg_class'))::text as value
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where ${userNamespace('n')} and ${notExtensionMember('pg_class', 'c.oid')}
        and c.relkind in ('r', 'p', 'v', 'm', 'f')`,
  sql`select 'column ' || n.nspname || '.' || c.relname || '.' || a.attname as key, jsonb_build_object(
        'position', (select count(*) from pg_attribute b where b.attrelid = a.attrelid
                     and b.attnum > 0 and not b.attisdropped and b.attnum <= a.attnum),
        'type', format_type(a.atttypid, a.atttypmod),
        'notNull', a.attnotnull,
        'default', pg_get_expr(d.adbin, d.adrelid),
        'identity', a.attidentity,
        'generated', a.attgenerated,
        'collation', (select co.collname from pg_collation co
                      where co.oid = a.attcollation and a.attcollation <> t.typcollation),
        'storage', nullif(a.attstorage, t.typstorage),
        'compression', a.attcompression,
        'statistics', a.attstattarget,
        'acl', ${sortedAcl('a.attacl')},
        'comment', col_description(c.oid, a.attnum))::text as value
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_type t on t.oid = a.atttypid
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where ${userNamespace('n')} and ${notExtensionMember('pg_class', 'c.oid')}
        and c.relkind in ('r', 'p', 'v', 'm', 'f', 'c') and a.attnum > 0 and not a.attisdropped`,
  sql`select 'constraint ' || n.nspname || '.' || c.relname || '.' || k.conname as key, jsonb_build_object(
        'type', k.contype,
        'definition', pg_get_constraintdef(k.oid),
        'validated', k.convalidated,
        'deferrable', k.condeferrable,
        'deferred', k.condeferred,
        'noInherit', k.connoinherit,
        'comment', obj_description(k.oid, 'pg_constraint'))::text as value
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where ${userNamespace('n')} and ${notExtensionMember('pg_class', 'c.oid')}`,
  sql`select 'index ' || n.nspname || '.' || i.relname as key, jsonb_build_object(
        'definition', pg_get_indexdef(i.oid),
        'valid', x.indisvalid,
        'clustered', x.indisclustered,
        'replicaIdentity', x.indisreplident,
        'options', i.reloptions,
        'statistics', (select array_agg(a.attstattarget order by a.attnum) from pg_attribute a
                       where a.attrelid = i.oid and a.attstattarget is not null),
        'comment', obj_description(i.oid, 'pg_class'))::text as value
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_namespace n on n.oid = i.relnamespace
      where ${userNamespace('n')} and ${notExtensionMember('pg_class', 'x.indrelid')}`,
  sql`select 'sequence ' || n.nspname || '.' || c.relname as key, jsonb_build_object(
        'owner', pg_get_userbyid(c.relowner),
        'acl', ${sortedAcl('c.relacl')},
        'type', format_type(s.seqtypid, null),
        'start', s.seqstart, 'increment', s.seqincrement,
        'min', s.seqmin, 'max', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle,
        'ownedBy', (select r.relname || '.' || a.attname from pg_depend d
                    join pg_class r on r.oid = d.refobjid
                    join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
                    where d.classid = 'pg_class'::regclass and d.objid = c.oid
                      and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')),
        'comment', obj_description(c.oid, 'pg_class'))::text as value
      from pg_sequence s
      join pg_class c on c.oid = s.seqrelid
      join pg_namespace n on n.oid = c.relnamespace
      where ${userNamespace('n')} and ${notExtensionMember('pg_class', 'c.oid')}`,
  sql`select 'function ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as key,
      jsonb_build_object(
        'kind', p.prokind,
        'owner', pg_get_userbyid(p.proowner),
        'acl', ${sortedAcl('p.proacl')},
        'definition', case when p.prokind <> 'a' then pg_get_functiondef(p.oid) end,
        'result', pg_get_function_result(p.oid),
        'comment', obj_description(p.oid, 'pg_proc'))::text as value
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where ${userNamespace('n')} and ${notExtensionMember('pg_proc', 'p.oid')}`,
  sql`select 'trigger ' || n.nspname || '.' || c.relname || '.' || t.tgname as key, jsonb_build_object(
        'definition', pg_get_triggerdef(t.oid),
        'enabled', t.tgenabled,
        'comment', obj_description(t.oid, 'pg_trigger'))::text as value
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal and ${userNamespace('n')} and ${notExtensionMember('pg_class', 'c.oid')}`,
  sql`select 'rule ' || n.nspname || '.' || c.relname || '.' || r.rulename as key, jsonb_build_object(
        'definition', pg_get_ruledef(r.oid),
        'enabled', r.ev_enabled)::text as value
      from pg_rewrite r
      join pg_class c on c.oid = r.ev_class
      join pg_namespace n on n.oid = c.relnamespace
      where r.rulename <> '_RETURN' and ${userNamespace('n')}`,
  sql`select 'policy ' || n.nspname || '.' || c.relname || '.' || p.polname as key, jsonb_build_object(
        'command', p.polcmd,
        'permissive', p.polpermissive,
        'roles', (select array_agg(case when r = 0 then 'public' else pg_get_userbyid(r) end order by 1)
                  from unnest(p.polroles) r),
        'using', pg_get_expr(p.polqual, p.polrelid),
        'check', pg_get_expr(p.polwithcheck, p.polrelid),
        'comment', obj_description(p.oid, 'pg_policy'))::text as value
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where ${userNamespace('n')}`,
  sql`select 'default privileges ' || pg_get_userbyid(d.defaclrole) || ' ' || coalesce(n.nspname, '*')
        || ' ' || d.defaclobjtype::text as key, jsonb_build_object('acl', ${sortedAcl('d.defaclacl')})::text as value
      from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace`,
  sql`select 'event trigger ' || e.evtname as key, jsonb_build_object(
        'event', e.evtevent, 'function', e.evtfoid::regprocedure::text,
        'owner', pg_get_userbyid(e.evtowner), 'enabled', e.evtenabled, 'tags', e.evttags)::text as value
      from pg_event_trigger e`,
  sql`select 'publication ' || p.pubname as key, jsonb_build_object(
        'owner', pg_get_userbyid(p.pubowner), 'allTables', p.puballtables,
        'insert', p.pubinsert, 'update', p.pubupdate, 'delete', p.pubdelete,
        'tables', (select array_agg(t.schemaname || '.' || t.tablename order by 1)
                   from pg_publication_tables t where t.pubname = p.pubname))::text as value
      from pg_publication p`,
  sql`with named as (
        select distinct r.oid from pg_roles r
        where r.rolname in (
          select (aclexplode(a)).grantee::regrole::text from (
            select nspacl a from pg_namespace union all select relacl from pg_class
            union all select attacl from pg_attribute union all select proacl from pg_proc
            union all select typacl from pg_type union all select defaclacl from pg_default_acl) acls
          where a is not null)
        or r.oid in (select unnest(polroles) from pg_policy)
        or r.oid in (select defaclrole from pg_default_acl))
      select 'role ' || r.rolname as key, jsonb_build_object(
        'superuser', r.rolsuper, 'inherit', r.rolinherit, 'createRole', r.rolcreaterole,
        'createDatabase', r.rolcreatedb, 'login', r.rolcanlogin, 'replication', r.rolreplication,
        'bypassRowSecurity', r.rolbypassrls, 'connectionLimit', r.rolconnlimit,
        'settings', r.rolconfig,
        'memberOf', (select array_agg(pg_get_userbyid(m.roleid) || case when m.admin_option then ' admin' else '' end
                       order by 1) from pg_auth_members m where m.member = r.oid))::text as value
      from pg_roles r join named using (oid)`,
];

/** Reads the whole catalog of the database `tx` is connected to. */
export async function readSchemaCatalog(tx: Tx): Promise<SchemaCatalog> {
  const catalog = new Map<string, string>();
  for (const read of catalogReads())
    for (const { key, value } of await query(tx, entry, read)) {
      if (catalog.has(key))
        throw new Error(
          `The catalog names ${key} twice; its key must be unique`,
        );
      catalog.set(key, value);
    }
  return catalog;
}
