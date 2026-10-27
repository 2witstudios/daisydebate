/**
 * Pure rules that keep the board following git: which task pages a PR
 * names, the status a merge moves them to (Done when the PR's latest review
 * verdict approves, ADR 0083), and which tasks drifted from git. The merge
 * workflow (merge-followup.ts) and `bun board:stale` share them.
 */
import { extractTaskIds, TASK_CODE } from './notify-drive';

/** The status a merged task waits in when no review verdict approved it. */
export const MERGED_STATUS = {
  slug: 'merged',
  name: 'Merged',
  color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  group: 'in_progress',
} as const;

const TASK_TITLE = new RegExp(String.raw`^(${TASK_CODE})\s+—`);

/** The task code a leaf title starts with, e.g. `RT-2.2f — Given …`. */
export const taskCode = (title: string): string | undefined =>
  TASK_TITLE.exec(title)?.[1];

type PageNode = {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly children?: readonly PageNode[];
};

export type TaskPage = {
  readonly code: string;
  readonly pageId: string;
  readonly listId: string;
};

/** Task pages in a drive tree, keyed by the code their title starts with. */
export function findTaskPages(
  nodes: readonly PageNode[],
  parentId?: string,
): readonly TaskPage[] {
  return nodes.flatMap((node) => {
    const code = taskCode(node.title);
    const own =
      code && node.type === 'TASK_LIST' && parentId
        ? [{ code, pageId: node.id, listId: parentId }]
        : [];
    return [...own, ...findTaskPages(node.children ?? [], node.id)];
  });
}

const TASKS_LINE = /^\s*[-*]?\s*Tasks?\s*:/;

/**
 * The task codes a PR delivers: those in its title, its branch and its
 * body's `Tasks:` line. A code the body only mentions (a later leaf, an ADR
 * citation, a related issue) is not delivered by the PR, and an ISSUE-n
 * closes only through a PR whose title or branch names it: a Tasks line
 * that links an issue (the one a PR filed, say) does not close it.
 */
export function deliveredCodes(
  pr: {
    readonly title: string;
    readonly headRefName: string;
    readonly body: string | null;
  },
  extract: (text: string) => readonly string[] = extractTaskIds,
): readonly string[] {
  const named = extract([pr.title, pr.headRefName].join('\n'));
  const listed = extract(
    (pr.body ?? '')
      .split('\n')
      .filter((line) => TASKS_LINE.test(line))
      .join('\n'),
  ).filter((code) => !code.startsWith('ISSUE-'));
  return [...new Set([...named, ...listed])];
}

/** Where a merge moves a task; undefined when it stays. */
export function mergedTarget(
  status: string,
  approved: boolean,
): string | undefined {
  const target = approved ? 'completed' : MERGED_STATUS.slug;
  return status === 'completed' || status === target ? undefined : target;
}

// The verdict line a /review comment carries (docs/development/reviews.md).
const VERDICT =
  /^(\d+) blockers? \/ (\d+) majors? \/ \d+ minors? \/ \d+ nits? — (APPROVE WITH MINORS|APPROVE|CHANGES REQUESTED)$/gm;
const REVIEWER = /^Reviewer: (\S+) · Builder: (\S+)/m;

/**
 * Whether the PR's latest review verdict approves the merged head: the last
 * `## Review:` comment carrying a whole-line verdict must name `headSha`, declare a reviewer
 * other than the builder, and approve with no open blocker or major. The
 * caller passes only comments from repository collaborators.
 */
export function approvedByReview(
  comments: readonly string[],
  headSha: string,
): boolean {
  const body = comments
    .filter(
      (text) =>
        text.trimStart().startsWith('## Review:') && text.match(VERDICT),
    )
    .at(-1);
  const last =
    body === undefined ? undefined : [...body.matchAll(VERDICT)].at(-1);
  const people = body === undefined ? null : REVIEWER.exec(body);
  return (
    body !== undefined &&
    last !== undefined &&
    body.includes(headSha) &&
    people !== null &&
    people[1] !== people[2] &&
    last[3] !== 'CHANGES REQUESTED' &&
    last[1] === '0' &&
    last[2] === '0'
  );
}

export type BoardTask = TaskPage & {
  readonly taskId: string;
  readonly status: string;
};

// Statuses before In Review: a merged task in one of them has drifted.
const BEFORE_REVIEW = new Set(['pending', 'ready', 'in_progress', 'blocked']);

/** Merged tasks still before In Review, with Merged as the status to fix to. */
export function staleLeaves(
  tasks: readonly BoardTask[],
  mergedAt: ReadonlyMap<string, string>,
): readonly {
  readonly task: BoardTask;
  readonly reason: string;
  readonly to: string;
}[] {
  return tasks.flatMap((task) =>
    mergedAt.has(task.code) && BEFORE_REVIEW.has(task.status)
      ? [
          {
            task,
            reason: `merged but ${task.status}`,
            to: MERGED_STATUS.slug,
          },
        ]
      : [],
  );
}
