import { resolve } from 'node:path';

const journalPath = 'packages/db/migrations/meta/_journal.json';
const root = resolve(import.meta.dir, '..');

export type JournalEntry = {
  readonly tag: string;
  readonly prevId?: string;
};

export type JournalProblemCode =
  'DUPLICATE_TAG' | 'TRUNCATED_HISTORY' | 'REWRITTEN_HISTORY' | 'BROKEN_CHAIN';

export type JournalProblem = {
  readonly code: JournalProblemCode;
  readonly detail: string;
};

export type MigrationCheckReport = {
  readonly ok: boolean;
  readonly baseRef: string;
  readonly baseCount: number;
  readonly headCount: number;
  readonly problems: readonly JournalProblem[];
};

export function parseJournal(json: string): readonly JournalEntry[] {
  const parsed = JSON.parse(json) as { entries?: unknown };
  if (!Array.isArray(parsed.entries))
    throw new Error(`${journalPath} has no entries array`);
  return parsed.entries.map((entry) => {
    const { tag, prevId } = entry as { tag?: unknown; prevId?: unknown };
    if (typeof tag !== 'string' || tag.length === 0)
      throw new Error(`${journalPath} entry without a tag`);
    return prevId === undefined ? { tag } : { tag, prevId: String(prevId) };
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
    const headTag = head[index]?.tag;
    if (headTag === undefined)
      problems.push({
        code: 'TRUNCATED_HISTORY',
        detail: `base migration ${entry.tag} is missing from this branch`,
      });
    else if (headTag !== entry.tag)
      problems.push({
        code: 'REWRITTEN_HISTORY',
        detail: `base migration ${entry.tag} no longer at position ${index} (found ${headTag})`,
      });
  }
  if (head[0]?.prevId)
    problems.push({
      code: 'BROKEN_CHAIN',
      detail: `first migration ${head[0].tag} declares prevId ${head[0].prevId}`,
    });
  for (const [index, entry] of head.slice(1).entries()) {
    const expected = head[index]?.tag;
    if (entry.prevId !== undefined && entry.prevId !== expected)
      problems.push({
        code: 'BROKEN_CHAIN',
        detail: `${entry.tag} declares prevId ${entry.prevId}, expected ${expected}`,
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

export async function runMigrationCheck(
  baseRef = process.argv[2] ?? 'origin/main',
): Promise<MigrationCheckReport> {
  const mergeBase = await gitOutput(['merge-base', 'HEAD', baseRef]);
  const base = parseJournal(await readCommittedJournal(mergeBase));
  const head = parseJournal(await readCommittedJournal('HEAD'));
  return createMigrationCheckReport(
    baseRef,
    base,
    head,
    findJournalProblems(base, head),
  );
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
