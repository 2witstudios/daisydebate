/**
 * Turns `pg_dump` output of a database migrated the old way into the
 * baseline's `migration.sql`, which the migrator applies in one
 * transaction as the migration owner, whoever that is. Pure: the caller
 * supplies the dump and the facts read from the source database.
 */

export type BaselineRole = { readonly name: string };

export type BaselineSource = {
  /** `pg_dump --no-owner --column-inserts --exclude-schema=drizzle` output. */
  readonly dump: string;
  /** The role that ran the old migrations and owns every object. */
  readonly owner: string;
  /** Login roles the schema grants to, created when missing (ADR 0038). */
  readonly roles: readonly BaselineRole[];
  /** Tables holding a transaction-id column, with its column names in order. */
  readonly transactionIdColumns: ReadonlyMap<string, readonly string[]>;
  readonly header: string;
  /**
   * CHECK expressions as their authors wrote them, by constraint name, for
   * the constraints whose `pg_dump` text parses to a different tree
   * (`a BETWEEN 1 AND 2 AND b` stores a nested AND that the dump's text
   * flattens). The generator finds them by building the baseline and
   * comparing catalogs.
   */
  readonly authoredChecks: ReadonlyMap<string, string>;
};

const breakpoint = '--> statement-breakpoint';

/** Session settings `pg_dump` emits; the migrator's session bounds stand. */
const droppedSettings = new Set([
  'statement_timeout',
  'lock_timeout',
  'idle_in_transaction_session_timeout',
  'transaction_timeout',
  'client_encoding',
  'standard_conforming_strings',
]);

const settingLine = /^SET ([a-z_]+) = (.+);$/;

/** Splits a VALUES list on its top-level commas, keeping quoted text whole. */
const splitValues = (values: string): readonly string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < values.length; index += 1) {
    const char = values[index];
    if (quoted) {
      if (char === "'" && values[index + 1] === "'") index += 1;
      else if (char === "'") quoted = false;
    } else if (char === "'") quoted = true;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(values.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(values.slice(start).trim());
  return parts;
};

const insertLine = /^INSERT INTO ([a-z0-9_.]+) \(([^)]*)\) VALUES \((.*)\);$/;

/**
 * A transaction id is a position in one cluster's history: the old
 * migration stamped the boundary with `pg_current_xact_id()`, so the
 * baseline does too, never the id of the database it was generated from.
 */
const restampTransactionIds = (
  line: string,
  columns: ReadonlyMap<string, readonly string[]>,
): string => {
  const match = insertLine.exec(line);
  if (!match) return line;
  const [, table = '', names = '', values = ''] = match;
  const stamped = columns.get(table);
  if (stamped === undefined) return line;
  const nameList = names.split(',').map((name) => name.trim());
  const valueList = splitValues(values);
  if (nameList.length !== valueList.length)
    throw new Error(`Cannot read the values of ${table}'s insert`);
  return `INSERT INTO ${table} (${names}) VALUES (${valueList
    .map((value, index) =>
      stamped.includes(nameList[index] ?? '') ? 'pg_current_xact_id()' : value,
    )
    .join(', ')});`;
};

const rolePrelude = (roles: readonly BaselineRole[]): string =>
  roles
    .map(
      ({ name }) => `DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${name}') THEN
    CREATE ROLE ${name} LOGIN;
  END IF;
END
$$;`,
    )
    .join(`\n${breakpoint}\n`);

/** The balanced parenthesized text that starts at `open`. */
const parenthesized = (text: string, open: number): string => {
  let depth = 0;
  let quoted = false;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === "'" && text[index + 1] === "'") index += 1;
      else if (char === "'") quoted = false;
    } else if (char === "'") quoted = true;
    else if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return text.slice(open, index + 1);
  }
  throw new Error('Unbalanced parentheses in a CHECK expression');
};

const checkStart = (name: string) =>
  new RegExp(`CONSTRAINT "?${name}"? CHECK \\(`, 'g');

/**
 * The expression the last folder of `history` that defines CHECK `name`
 * wrote for it, in parentheses.
 */
export function authoredCheck(
  history: readonly string[],
  name: string,
): string {
  for (const sql of [...history].reverse()) {
    const starts = [...sql.matchAll(checkStart(name))];
    const last = starts.at(-1);
    if (last) return parenthesized(sql, last.index + last[0].length - 1);
  }
  throw new Error(`No folder defines CHECK ${name}`);
}

const withAuthoredChecks = (
  dump: string,
  checks: ReadonlyMap<string, string>,
): string =>
  [...checks].reduce((text, [name, expression]) => {
    const [found, ...more] = [...text.matchAll(checkStart(name))];
    if (!found || more.length > 0)
      throw new Error(`The dump must define CHECK ${name} once`);
    const open = found.index + found[0].length - 1;
    return `${text.slice(0, open)}${expression}${text.slice(open + parenthesized(text, open).length)}`;
  }, dump);

export function baselineSql(source: BaselineSource): string {
  const ownerGrant = new RegExp(`\\b(TO|FROM) ${source.owner}\\b`);
  const lines = withAuthoredChecks(source.dump, source.authoredChecks).split('\n').flatMap((line): string[] => {
    // psql meta-commands (`\restrict`) are not SQL the migrator can send.
    if (line.startsWith('\\')) return [];
    if (line.startsWith('COMMENT ON EXTENSION')) return [];
    const setting = settingLine.exec(line);
    if (setting) {
      const [, name = '', value = ''] = setting;
      return droppedSettings.has(name) ? [] : [`SET LOCAL ${name} = ${value};`];
    }
    if (line === "SELECT pg_catalog.set_config('search_path', '', false);")
      return ["SELECT pg_catalog.set_config('search_path', '', true);"];
    if (line.startsWith('ALTER DEFAULT PRIVILEGES FOR ROLE ')) {
      const prefix = `ALTER DEFAULT PRIVILEGES FOR ROLE ${source.owner} `;
      if (!line.startsWith(prefix))
        throw new Error(`Default privileges name a role other than ${source.owner}`);
      return [`ALTER DEFAULT PRIVILEGES ${line.slice(prefix.length)}`];
    }
    if (/^(GRANT|REVOKE) /.test(line) && ownerGrant.test(line))
      throw new Error(`A privilege names the owner ${source.owner}: ${line}`);
    return [restampTransactionIds(line, source.transactionIdColumns)];
  });
  // Each pg_dump entry starts with a `-- Name:` header; a breakpoint before
  // it lets the migrator name the statement that failed.
  const body = lines
    .join('\n')
    .replace(/\n--\n-- (Name|Data for Name): /g, `\n${breakpoint}\n--\n-- $1: `)
    .trim();
  return `${source.header}\n${rolePrelude(source.roles)}\n${breakpoint}\n${body}\n`;
}
