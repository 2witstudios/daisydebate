#!/usr/bin/env bun
/**
 * `bun board:stale [--apply]` (ADR 0035): lists tasks whose status disagrees
 * with git — merged but not yet In Review, or Done without a review record —
 * and with --apply moves each to its correct pre-Done status (Merged, or In
 * Review when unmerged). It never marks anything Done and never files review
 * debt: merges before the enforcement cutoff are listed, not filed.
 */
import {
  MERGED_STATUS,
  staleLeaves,
  taskCode,
  type BoardTask,
} from './board-state';
import { DAISY_DEBATE_DRIVE_ID } from './pagespace-docs';
import { extractTaskIds } from './notify-drive';

type Result = { readonly code: number; readonly stdout: string };
type MergedPr = {
  readonly number: number;
  readonly title: string;
  readonly headRefName: string;
  readonly body: string;
};

export type StaleDeps = {
  readonly pagespace: (args: readonly string[]) => Result;
  readonly mergedPrs: () => readonly MergedPr[];
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

function readBoard(deps: StaleDeps) {
  const { pages } = json<{
    pages: { id: string; type: string; hasChildren?: boolean }[];
  }>(deps, ['pages', 'tree', '--drive', DAISY_DEBATE_DRIVE_ID]);
  const lists = new Map<string, TaskList>();
  const tasks: BoardTask[] = [];
  for (const page of pages) {
    if (page.type !== 'TASK_LIST' || !page.hasChildren) continue;
    const list = json<TaskList>(deps, ['tasks', 'list', page.id]);
    lists.set(page.id, list);
    for (const task of list.tasks) {
      const code = taskCode(task.title);
      if (!code) continue;
      const content =
        task.status === 'completed'
          ? (json<{ content?: string }>(deps, ['pages', 'read', task.pageId])
              .content ?? '')
          : '';
      tasks.push({
        code,
        pageId: task.pageId,
        listId: page.id,
        taskId: task.id,
        status: task.status,
        hasReviewRecord: /Review record/.test(content),
      });
    }
  }
  return { lists, tasks };
}

export function runStaleCheck(deps: StaleDeps, apply: boolean): number {
  const merged = new Set(
    deps
      .mergedPrs()
      .flatMap((pr) =>
        extractTaskIds(`${pr.title} ${pr.headRefName} ${pr.body}`),
      ),
  );
  const { lists, tasks } = readBoard(deps);
  const stale = staleLeaves(tasks, merged);
  for (const { task, reason, to } of stale)
    deps.out(`${task.code} ${reason} → ${to}  (${task.pageId})\n`);
  deps.out(`${stale.length} stale of ${tasks.length} tasks\n`);
  if (!apply) return 0;
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
  return 0;
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
      pagespace: (args) => spawn('pagespace', args),
      mergedPrs: () =>
        JSON.parse(
          spawn('gh', [
            'pr',
            'list',
            '--state',
            'merged',
            '--limit',
            '1000',
            '--json',
            'number,title,headRefName,body',
          ]).stdout,
        ) as MergedPr[],
      out: (text) => process.stdout.write(text),
    },
    process.argv.includes('--apply'),
  );
}
