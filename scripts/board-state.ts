/**
 * Pure rules that keep the board following git (ADR 0035): which task pages
 * a PR names, the status a merge moves them to, when a merge after the
 * enforcement cutoff leaves review debt, and which tasks drifted from git.
 * The merge workflow (merge-followup.ts) and `bun board:stale` share them.
 */

/** The status a merged task waits in until an independent review grants Done. */
export const MERGED_STATUS = {
  slug: 'merged',
  name: 'Merged',
  color: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  group: 'in_progress',
} as const;

const TASK_TITLE = /^([A-Z]{2,6}-\d+(?:\.\d+)?[a-z]?)\s+—/;

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

/** Where a merge moves a task; undefined when it stays. */
export function mergedTarget(status: string): string | undefined {
  return status === MERGED_STATUS.slug || status === 'completed'
    ? undefined
    : MERGED_STATUS.slug;
}

export function needsDebt(input: {
  readonly mergedAt: string;
  readonly cutoff: string | null;
  readonly reviewState: string | undefined;
}): boolean {
  return (
    input.cutoff !== null &&
    Date.parse(input.mergedAt) >= Date.parse(input.cutoff) &&
    input.reviewState !== 'success'
  );
}

export function debtIssue(input: {
  readonly pr: number;
  readonly title: string;
  readonly url: string;
  readonly headSha: string;
  readonly codes: readonly string[];
}): { readonly title: string; readonly criteria: readonly string[] } {
  const sha = input.headSha.slice(0, 12);
  const tasks = input.codes.length > 0 ? input.codes.join(', ') : 'no task';
  return {
    title: `Given PR #${input.pr} merged without a review record, should get a post-merge independent review of ${sha}`,
    criteria: [
      `Given PR #${input.pr} (${input.title}, ${input.url}) merged at head ${input.headSha} with no review-record status, should get an independent review record for ${sha} under Reviews/<Epic>, linked from ${tasks}.`,
      `Given that record's findings, should fix or file each one; the tasks stay Merged until the record grants Done.`,
    ],
  };
}

export type BoardTask = TaskPage & {
  readonly taskId: string;
  readonly status: string;
  readonly hasReviewRecord: boolean;
};

// Statuses before In Review: a merged task in one of them has drifted.
const BEFORE_REVIEW = new Set(['pending', 'ready', 'in_progress', 'blocked']);

/** Tasks whose status disagrees with git, with the pre-Done status to fix to. */
export function staleLeaves(
  tasks: readonly BoardTask[],
  mergedCodes: ReadonlySet<string>,
): readonly {
  readonly task: BoardTask;
  readonly reason: string;
  readonly to: string;
}[] {
  return tasks.flatMap((task) => {
    const merged = mergedCodes.has(task.code);
    if (merged && BEFORE_REVIEW.has(task.status))
      return [
        { task, reason: `merged but ${task.status}`, to: MERGED_STATUS.slug },
      ];
    if (task.status === 'completed' && !task.hasReviewRecord)
      return [
        {
          task,
          reason: 'Done without a review record',
          to: merged ? MERGED_STATUS.slug : 'in_review',
        },
      ];
    return [];
  });
}
