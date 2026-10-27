#!/usr/bin/env bun
/**
 * `bun board:stale [--apply]`: lists tasks whose status disagrees with
 * git — merged but not yet In Review — and with --apply moves each to
 * Merged. It never marks anything Done. An ISSUE-n filed directly under
 * Issues instead of in a bucket is an error.
 */
import {
  deliveredCodes,
  MERGED_STATUS,
  staleLeaves,
  taskCode,
  type BoardTask,
} from './board-state';
import { ISSUES_LIST_ID, strayIssues } from './board-model';
import { DAISY_DEBATE_DRIVE_ID } from './pagespace-docs';

type Result = { readonly code: number; readonly stdout: string };
type MergedPr = {
  readonly number: number;
  readonly mergedAt: string;
  readonly title: string;
  readonly headRefName: string;
  readonly body: string;
};

export type StaleDeps = {
  readonly pagespace: (args: readonly string[]) => Result;
  readonly gh: (args: readonly string[]) => Result;
  readonly out: (text: string) => void;
};

type TaskList = {
  readonly tasks: readonly {
    readonly id: string;
    readonly pageId: string;
    readonly title: string;
    readonly status: string;
  }[];
  readonly availableStatuses: readonly { readonly slug: string }[];
};

function json<T>(deps: StaleDeps, args: readonly string[]): T {
  const result = deps.pagespace([...args, '--json']);
  if (result.code !== 0) throw new Error(`pagespace ${args.join(' ')} failed`);
  return JSON.parse(result.stdout) as T;
}

type TreePage = {
  id: string;
  type: string;
  title: string;
  hasChildren?: boolean;
};

const tree = (deps: StaleDeps) =>
  json<{ pages: TreePage[] }>(deps, [
    'pages',
    'tree',
    '--drive',
    DAISY_DEBATE_DRIVE_ID,
  ]).pages;

function readBoard(deps: StaleDeps) {
  const pages = tree(deps);
  const lists = new Map<string, TaskList>();
  const tasks: BoardTask[] = [];
  for (const page of pages) {
    if (page.type !== 'TASK_LIST' || !page.hasChildren) continue;
    const list = json<TaskList>(deps, ['tasks', 'list', page.id]);
    lists.set(page.id, list);
    for (const task of list.tasks) {
      const code = taskCode(task.title);
      if (!code) continue;
      tasks.push({
        code,
        pageId: task.pageId,
        listId: page.id,
        taskId: task.id,
        status: task.status,
      });
    }
  }
  return { lists, tasks };
}

/**
 * Issue numbering and the board walk read one bucket level, so an issue
 * filed directly under Issues is an error. Returns the exit code it implies.
 */
function reportStrays(deps: StaleDeps, lists: ReadonlyMap<string, TaskList>) {
  const strays = strayIssues(lists.get(ISSUES_LIST_ID)?.tasks ?? []);
  for (const issue of strays)
    deps.out(
      `ERROR ${issue.code} sits directly under Issues; file it into a bucket  (${issue.pageId})\n`,
    );
  return strays.length > 0 ? 1 : 0;
}

const MERGED_PRS = [
  'pr',
  'list',
  '--state',
  'merged',
  '--limit',
  '1000',
  '--json',
  'number,title,headRefName,body,mergedAt',
];

export function runStaleCheck(deps: StaleDeps, apply: boolean): number {
  const listed = deps.gh(MERGED_PRS);
  if (listed.code !== 0) {
    deps.out(`gh pr list failed (exit ${listed.code}); nothing was checked.\n`);
    return 1;
  }
  const merged = new Map<string, string>();
  for (const pr of JSON.parse(listed.stdout) as MergedPr[])
    for (const code of deliveredCodes(pr))
      if (!merged.has(code) || pr.mergedAt < (merged.get(code) ?? ''))
        merged.set(code, pr.mergedAt);
  const { lists, tasks } = readBoard(deps);
  const stale = staleLeaves(tasks, merged);
  for (const { task, reason, to } of stale)
    deps.out(`${task.code} ${reason} → ${to}  (${task.pageId})\n`);
  deps.out(`${stale.length} stale of ${tasks.length} tasks\n`);
  const strays = reportStrays(deps, lists);
  if (!apply) return strays;
  const withMerged = new Set(
    [...lists]
      .filter(([, list]) =>
        list.availableStatuses.some((s) => s.slug === MERGED_STATUS.slug),
      )
      .map(([id]) => id),
  );
  for (const { task, to } of stale) {
    if (to === MERGED_STATUS.slug && !withMerged.has(task.listId)) {
      json(deps, [
        'tasks',
        'create-status',
        task.listId,
        '--name',
        MERGED_STATUS.name,
        '--color',
        MERGED_STATUS.color,
        '--group',
        MERGED_STATUS.group,
      ]);
      withMerged.add(task.listId);
    }
    json(deps, ['tasks', 'update', task.listId, task.taskId, '--status', to]);
  }
  deps.out(`applied ${stale.length} status changes; nothing marked Done\n`);
  return strays;
}

if (import.meta.main) {
  const spawn = (command: string, args: readonly string[]): Result => {
    const result = Bun.spawnSync([command, ...args], {
      stdout: 'pipe',
      stderr: 'inherit',
    });
    return { code: result.exitCode, stdout: result.stdout.toString() };
  };
  process.exitCode = runStaleCheck(
    {
      // A walk of the whole drive makes hundreds of calls; retry a transient
      // network failure twice rather than abandon the run.
      pagespace: (args) => {
        let result = spawn('pagespace', args);
        for (let retry = 0; retry < 2 && result.code !== 0; retry += 1) {
          Bun.sleepSync(1000);
          result = spawn('pagespace', args);
        }
        return result;
      },
      gh: (args) => spawn('gh', args),
      out: (text) => process.stdout.write(text),
    },
    process.argv.includes('--apply'),
  );
}
