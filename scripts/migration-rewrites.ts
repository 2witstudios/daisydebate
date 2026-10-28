/**
 * Row rewrites in a new migration (ISSUE-788): statements that touch rows a
 * database may already hold. CI's fresh databases hold none, so each needs a
 * seeded proof, and DDL after a rewrite of the same table must first flush
 * the deferred trigger events the rewrite queued.
 */
export type RewriteProblem = {
  readonly code: 'UNPROVEN_REWRITE' | 'PENDING_TRIGGER_HAZARD';
  readonly detail: string;
};

const name = String.raw`(?:ONLY\s+)?(?:"?\w+"?\.)?"?(\w+)"?`;
const created = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${name}`,
  'i',
);
const rewrite = new RegExp(
  String.raw`^(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+${name}`,
  'i',
);
const ddl = new RegExp(
  String.raw`^(?:ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?${name}|CREATE\s+(?:UNIQUE\s+)?INDEX\b.*?\bON\s+${name})`,
  'is',
);
const flush = /^SET\s+CONSTRAINTS\s+ALL\s+IMMEDIATE/i;

/** Top-level statements, without comments or dollar-quoted bodies. */
const statements = (sql: string) =>
  sql
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

export function findRewriteProblems(input: {
  readonly tag: string;
  readonly sql: string;
  /** Whether an integration test names this migration. */
  readonly proven: boolean;
}): readonly RewriteProblem[] {
  const own = new Set<string>();
  const rewritten = new Set<string>();
  const pending = new Set<string>();
  const hazards = new Set<string>();
  for (const statement of statements(input.sql)) {
    const table = created.exec(statement)?.[1];
    if (table) own.add(table);
    const target = rewrite.exec(statement)?.[1];
    if (target && !own.has(target)) {
      rewritten.add(target);
      pending.add(target);
    }
    const altered = ddl.exec(statement);
    const ddlTable = altered?.[1] ?? altered?.[2];
    if (ddlTable && pending.has(ddlTable)) hazards.add(ddlTable);
    if (flush.test(statement)) pending.clear();
  }
  return [
    ...(rewritten.size > 0 && !input.proven
      ? [
          {
            code: 'UNPROVEN_REWRITE' as const,
            detail: `${input.tag} rewrites existing rows of ${[...rewritten].join(', ')}; prove it with an integration test that names it, seeds those rows on a scratch database migrated to the migration before it, then applies it (docs/operations/database.md)`,
          },
        ]
      : []),
    ...[...hazards].map((table) => ({
      code: 'PENDING_TRIGGER_HAZARD' as const,
      detail: `${input.tag} alters ${table} after rewriting its rows; a deferred trigger on ${table} fails that DDL with pending trigger events. Put SET CONSTRAINTS ALL IMMEDIATE before it, or split the migration`,
    })),
  ];
}
