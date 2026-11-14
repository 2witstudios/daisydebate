import type { JudgeListQuery } from '@daisy/protocol/lobby/entry-read';
import { matchesQuery } from './at-scale';
import type { HostJudges } from './entries';
export type JudgeFilter = {
  readonly query: string;
  readonly status: JudgeListQuery['status'];
  readonly slotId: string | null;
};
type Judge = HostJudges['groups'][number]['judges'][number];
const matchesStatus = (
  judge: Judge,
  index: number,
  status: JudgeFilter['status'],
): boolean => {
  switch (status) {
    case 'all':
      return true;
    case 'free':
      return judge.slots[index]?.state === 'free';
    case 'late':
      return judge.slots[index]?.state === 'late';
    case 'conflict':
      return judge.conflict;
    case 'not_cleared':
      return !judge.cleared;
  }
};
export function judgeSearchOf(judges: HostJudges, filter: JudgeFilter) {
  const index = judges.slots.findIndex((slot) => slot.id === filter.slotId);
  const found = judges.groups.map((group) => ({
    ...group,
    judges: group.judges.filter((judge) =>
      matchesQuery(filter.query, [
        judge.name,
        group.name,
        judge.neverJudges,
        judge.clearedFor,
        ...judge.slots.map((slot) => slot.label),
      ]),
    ),
  }));
  const labels = {
    all: 'All',
    free: `Free ${judges.slots[index]?.label ?? 'in this slot'}`,
    conflict: 'Has a conflict',
    late: 'Ballot overdue',
    not_cleared: 'Not cleared yet',
  } as const;
  return {
    choices: (['all', 'free', 'conflict', 'late', 'not_cleared'] as const).map(
      (status) => ({
        id: status,
        label: labels[status],
        count: found.reduce(
          (sum, group) =>
            sum +
            group.judges.filter((judge) => matchesStatus(judge, index, status))
              .length,
          0,
        ),
      }),
    ),
    groups: found
      .map((group) => ({
        ...group,
        judges: group.judges.filter((judge) =>
          matchesStatus(judge, index, filter.status),
        ),
      }))
      .filter((group) => group.judges.length > 0),
  };
}
