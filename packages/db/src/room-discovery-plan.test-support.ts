type Plan = {
  readonly 'Relation Name'?: string;
  readonly 'Actual Rows': number;
  readonly 'Actual Loops': number;
  readonly 'Rows Removed by Filter'?: number;
  readonly 'Rows Removed by Index Recheck'?: number;
  readonly Plans?: readonly Plan[];
};

/** Physical Room/Round work includes rejected rows, not just returned candidates. */
export const discoveryRelationWork = (plan: Plan): number => {
  const own = ['rooms', 'rounds'].includes(plan['Relation Name'] ?? '')
    ? (plan['Actual Rows'] +
        (plan['Rows Removed by Filter'] ?? 0) +
        (plan['Rows Removed by Index Recheck'] ?? 0)) *
      plan['Actual Loops']
    : 0;
  return (
    own +
    (plan.Plans ?? []).reduce(
      (sum, child) => sum + discoveryRelationWork(child),
      0,
    )
  );
};
