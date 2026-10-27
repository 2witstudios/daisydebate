#!/usr/bin/env bun
/**
 * Runs after every merge to main (.github/workflows/notify-merge.yml). It
 * moves each task the PR names to Done when the PR's latest review verdict
 * approves (reviews are PR comments, ADR 0083), and otherwise to Merged,
 * where the board keeper reconciles it.
 */
import {
  approvedByReview,
  deliveredCodes,
  findTaskPages,
  MERGED_STATUS,
  mergedTarget,
} from './board-state';
import { DAISY_DEBATE_DRIVE_ID, pagespaceApi } from './pagespace-docs';

export type MergedPr = {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly branch: string;
};

type PageNode = Parameters<typeof findTaskPages>[0][number];
type TaskList = {
  readonly tasks: readonly {
    readonly id: string;
    readonly pageId: string;
    readonly status: string;
  }[];
  readonly availableStatuses: readonly { readonly slug: string }[];
};

/** One page of GET /api/pages/:id/tasks, as the PageSpace server returns it. */
type TasksPage = {
  readonly tasks: readonly {
    readonly id: string;
    readonly pageId: string;
    readonly status: string;
    readonly title?: string;
  }[];
  readonly statusConfigs?: readonly { readonly slug: string }[];
  readonly hasMore?: boolean;
};

const TASKS_PAGE_SIZE = 200;

/**
 * A whole task list from the REST API: statuses come from statusConfigs
 * (the CLI calls them availableStatuses), and tasks from every page, since
 * the server returns at most `limit` per request and reports hasMore.
 */
export async function readTaskList(
  fetchPage: (offset: number) => Promise<TasksPage>,
): Promise<TaskList & { readonly titles: readonly string[] }> {
  const tasks: TasksPage['tasks'][number][] = [];
  let statuses: readonly { readonly slug: string }[] = [];
  // Advance by the rows received: a server may cap a page below the limit.
  for (let offset = 0; ;) {
    const page = await fetchPage(offset);
    if (offset === 0) statuses = page.statusConfigs ?? [];
    tasks.push(...page.tasks);
    if (!page.hasMore || page.tasks.length === 0) break;
    offset += page.tasks.length;
  }
  return {
    tasks,
    availableStatuses: statuses.map(({ slug }) => ({ slug })),
    titles: tasks.map((task) => task.title ?? ''),
  };
}

const tasksOf = (listId: string) =>
  readTaskList((offset) =>
    pagespace<TasksPage>(
      `/api/pages/${listId}/tasks?limit=${TASKS_PAGE_SIZE}&offset=${offset}`,
    ),
  );

export type FollowupDeps = {
  readonly drivePages: () => Promise<readonly PageNode[]>;
  readonly listTasks: (listId: string) => Promise<TaskList>;
  readonly createStatus: (listId: string) => Promise<void>;
  readonly updateStatus: (
    listId: string,
    taskId: string,
    status: string,
  ) => Promise<void>;
  /** The PR's comment bodies, oldest first. */
  readonly comments: () => Promise<readonly string[]>;
};

async function moveTasks(
  deps: FollowupDeps,
  pages: ReturnType<typeof findTaskPages>,
  approved: boolean,
) {
  const moved: string[] = [];
  for (const listId of new Set(pages.map((page) => page.listId))) {
    const list = await deps.listTasks(listId);
    let hasStatus = list.availableStatuses.some(
      (status) => status.slug === MERGED_STATUS.slug,
    );
    for (const page of pages.filter((p) => p.listId === listId)) {
      const task = list.tasks.find((t) => t.pageId === page.pageId);
      const target = task && mergedTarget(task.status, approved);
      if (!task || !target) continue;
      if (target === MERGED_STATUS.slug && !hasStatus)
        await deps.createStatus(listId);
      hasStatus = true;
      await deps.updateStatus(listId, task.id, target);
      moved.push(page.code);
    }
  }
  return moved;
}

export async function followUpMerge(
  deps: FollowupDeps,
  pr: MergedPr,
): Promise<{ readonly moved: readonly string[]; readonly status: string }> {
  const codes = deliveredCodes({
    title: pr.title,
    headRefName: pr.branch,
    body: pr.body,
  });
  const pages = findTaskPages(await deps.drivePages()).filter((page) =>
    codes.includes(page.code),
  );
  const approved = approvedByReview(await deps.comments());
  return {
    moved: await moveTasks(deps, pages, approved),
    status: approved ? 'completed' : MERGED_STATUS.slug,
  };
}

// ------------------------------------------------------------------- edges

async function pagespace<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiUrl, headers } = pagespaceApi();
  const response = await fetch(new URL(path, apiUrl), {
    ...init,
    headers,
    redirect: 'error',
  });
  if (!response.ok)
    throw new Error(
      `PageSpace ${init?.method ?? 'GET'} ${path} ${response.status}`,
    );
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
});

function liveDeps(repository: string, pr: number): FollowupDeps {
  return {
    drivePages: () =>
      pagespace<readonly PageNode[]>(
        `/api/drives/${DAISY_DEBATE_DRIVE_ID}/pages`,
      ),
    listTasks: tasksOf,
    createStatus: async (listId) => {
      await pagespace(
        `/api/pages/${listId}/tasks/statuses`,
        json('POST', {
          name: MERGED_STATUS.name,
          color: MERGED_STATUS.color,
          group: MERGED_STATUS.group,
        }),
      );
    },
    updateStatus: async (listId, taskId, status) => {
      await pagespace(
        `/api/pages/${listId}/tasks/${taskId}`,
        json('PATCH', { status }),
      );
    },
    comments: async () => {
      const result = Bun.spawnSync(
        [
          'gh',
          'api',
          '--paginate',
          `repos/${repository}/issues/${pr}/comments`,
          '--jq',
          '.[].body | @json',
        ],
        { stdout: 'pipe', stderr: 'inherit' },
      );
      if (result.exitCode !== 0)
        throw new Error(`gh could not read the comments of PR #${pr}`);
      return result.stdout
        .toString()
        .split('\n')
        .filter(Boolean)
        .map((line): unknown => JSON.parse(line))
        .filter((body): body is string => typeof body === 'string');
    },
  };
}

if (import.meta.main) {
  const env = process.env;
  const pr: MergedPr = {
    number: Number(env.MERGE_PR),
    title: env.MERGE_TITLE ?? '',
    body: env.MERGE_BODY ?? '',
    branch: env.MERGE_BRANCH ?? '',
  };
  if (!Number.isInteger(pr.number) || pr.number <= 0) {
    process.stderr.write('merge-followup: MERGE_PR is required\n');
    process.exit(2);
  }
  const result = await followUpMerge(
    liveDeps(env.GITHUB_REPOSITORY ?? '', pr.number),
    pr,
  );
  process.stdout.write(
    `merge follow-up #${pr.number}: moved ${result.moved.join(', ') || 'no task'} to ${result.status}\n`,
  );
}
