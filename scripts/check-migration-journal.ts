import { resolve } from 'node:path';

const migrationsDir = 'packages/db/migrations';
const journalPath = `${migrationsDir}/meta/_journal.json`;
const root = resolve(import.meta.dir, '..');

export type JournalEntry = {
  readonly tag: string;
  readonly [field: string]: unknown;
};

export type JournalProblemCode =
  | 'DUPLICATE_TAG'
  | 'TRUNCATED_HISTORY'
  | 'REWRITTEN_HISTORY'
  | 'REWRITTEN_METADATA'
  | 'REWRITTEN_SQL'
  | 'BROKEN_CHAIN';

export type JournalProblem = {
  readonly code: JournalProblemCode;
  readonly detail: string;
};

export type SharedMigrationFile = {
  readonly tag: string;
  readonly base: string | undefined;
  readonly head: string | undefined;
};

export type MigrationCheckReport = {
  readonly ok: boolean;
  readonly baseRef: string;
  readonly baseCount: number;
  readonly headCount: number;
  readonly problems: readonly JournalProblem[];
};

export const parseBaseRef = (argv: readonly string[]): string =>
  argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'origin/main';

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      return entry;
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : 1,
      ),
    );
  });

export function parseJournal(json: string): readonly JournalEntry[] {
  const parsed = JSON.parse(json) as { entries?: unknown };
  if (!Array.isArray(parsed.entries))
    throw new Error(`${journalPath} has no entries array`);
  return parsed.entries.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry))
      throw new Error(`${journalPath} entry is not an object`);
    const { tag } = entry as { tag?: unknown };
    if (typeof tag !== 'string' || tag.length === 0)
      throw new Error(`${journalPath} entry without a tag`);
    return { ...entry, tag } as JournalEntry;
  });
}

export function findJournalProblems(
  base: readonly JournalEntry[],
  head: readonly JournalEntry[],
): readonly JournalProblem[] {
  const problems: JournalProblem[] = [];
  const seen = new Set<string>();
  for (const { tag } of head) {
    if (seen.has(tag))
      problems.push({
        code: 'DUPLICATE_TAG',
        detail: tag,
      });
    seen.add(tag);
  }
  for (const [index, entry] of base.entries()) {
    const headEntry = head[index];
    if (headEntry === undefined)
      problems.push({
        code: 'TRUNCATED_HISTORY',
        detail: `base migration ${entry.tag} is missing from this branch`,
      });
    else if (headEntry.tag !== entry.tag)
      problems.push({
        code: 'REWRITTEN_HISTORY',
        detail: `base migration ${entry.tag} no longer at position ${index} (found ${headEntry.tag})`,
      });
    else if (stableStringify(entry) !== stableStringify(headEntry))
      problems.push({
        code: 'REWRITTEN_METADATA',
        detail: `base migration ${entry.tag} has edited journal metadata (when, breakpoints, or prevId) on this branch`,
      });
  }
  if (head[0]?.prevId)
    problems.push({
      code: 'BROKEN_CHAIN',
      detail: `first migration ${head[0].tag} declares prevId ${String(head[0].prevId)}`,
    });
  for (const [index, entry] of head.slice(1).entries()) {
    const expected = head[index]?.tag;
    if (entry.prevId !== undefined && entry.prevId !== expected)
      problems.push({
        code: 'BROKEN_CHAIN',
        detail: `${entry.tag} declares prevId ${String(entry.prevId)}, expected ${expected}`,
      });
  }
  return problems;
}

export function findSharedFileProblems(
  files: readonly SharedMigrationFile[],
): readonly JournalProblem[] {
  const problems: JournalProblem[] = [];
  for (const { tag, base, head } of files) {
    if (base === undefined) continue;
    if (head === undefined)
      problems.push({
        code: 'REWRITTEN_SQL',
        detail: `shared migration ${tag}.sql was deleted on this branch`,
      });
    else if (head !== base)
      problems.push({
        code: 'REWRITTEN_SQL',
        detail: `shared migration ${tag}.sql was rewritten on this branch`,
      });
  }
  return problems;
}

export function createMigrationCheckReport(
  baseRef: string,
  base: readonly JournalEntry[],
  head: readonly JournalEntry[],
  problems: readonly JournalProblem[],
): MigrationCheckReport {
  return {
    ok: problems.length === 0,
    baseRef,
    baseCount: base.length,
    headCount: head.length,
    problems,
  };
}

export function formatMigrationCheckReport(
  report: MigrationCheckReport,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`;
  if (report.ok)
    return `Migrations: PASS (${report.headCount} committed, base ${report.baseCount} from ${report.baseRef})\n`;
  return [
    'Migrations: FAIL',
    ...report.problems.map(({ code, detail }) => `  ${code}: ${detail}`),
    '  Applied migrations are immutable: never rewrite, reorder, or remove',
    '  committed migrations. Rebase onto the base ref, then regenerate the',
    '  conflicting tail with `bun db:generate` as a forward correction.',
    '',
  ].join('\n');
}

async function gitOutput(args: readonly string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0)
    throw new Error(
      `git ${args.join(' ')} failed (exit ${exitCode}); fetch the base ref first (git fetch origin)`,
    );
  return stdout.trim();
}

export async function readCommittedJournal(ref: string): Promise<string> {
  return gitOutput(['show', `${ref}:${journalPath}`]);
}

async function readOptionalCommittedFile(
  ref: string,
  path: string,
): Promise<string | undefined> {
  const child = Bun.spawn(['git', 'show', `${ref}:${path}`], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) return undefined;
  return stdout;
}

async function readSharedMigrationFiles(
  mergeBase: string,
  sharedTags: readonly string[],
): Promise<readonly SharedMigrationFile[]> {
  return Promise.all(
    sharedTags.map(async (tag): Promise<SharedMigrationFile> => {
      const path = `${migrationsDir}/${tag}.sql`;
      return {
        tag,
        base: await readOptionalCommittedFile(mergeBase, path),
        head: await readOptionalCommittedFile('HEAD', path),
      };
    }),
  );
}

export async function runMigrationCheck(
  baseRef = parseBaseRef(process.argv),
): Promise<MigrationCheckReport> {
  const mergeBase = await gitOutput(['merge-base', 'HEAD', baseRef]);
  const base = parseJournal(await readCommittedJournal(mergeBase));
  const head = parseJournal(await readCommittedJournal('HEAD'));
  const sharedTags = base
    .map(({ tag }, index) => (head[index]?.tag === tag ? tag : undefined))
    .filter((tag): tag is string => tag !== undefined);
  const sharedFiles = await readSharedMigrationFiles(mergeBase, sharedTags);
  return createMigrationCheckReport(baseRef, base, head, [
    ...findJournalProblems(base, head),
    ...findSharedFileProblems(sharedFiles),
  ]);
}

if (import.meta.main) {
  try {
    const report = await runMigrationCheck();
    process.stdout.write(
      formatMigrationCheckReport(report, process.argv.includes('--json')),
    );
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Migration check failed'}\n`,
    );
    process.exitCode = 1;
  }
}
