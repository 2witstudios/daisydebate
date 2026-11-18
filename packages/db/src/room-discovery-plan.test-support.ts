export type DiscoveryPlan = {
  readonly 'Relation Name'?: string;
  readonly 'Actual Rows': number;
  readonly 'Actual Loops': number;
  readonly 'Rows Removed by Filter'?: number;
  readonly 'Rows Removed by Index Recheck'?: number;
  readonly 'Shared Hit Blocks'?: number;
  readonly 'Shared Read Blocks'?: number;
  readonly Plans?: readonly DiscoveryPlan[];
};

const historical = (plan: DiscoveryPlan) =>
  ['rooms', 'rounds'].includes(plan['Relation Name'] ?? '');

/** Physical Room/Round work includes rejected rows, not just returned candidates. */
export const discoveryRelationWork = (plan: DiscoveryPlan): number => {
  const own = historical(plan)
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

const blocks = (plan: DiscoveryPlan) =>
  (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);

/**
 * Pages the Room/Round scans themselves touched, hit or read, so index pages
 * walked past without yielding a row still count. EXPLAIN reports buffers
 * inclusive of child nodes, so each scan's children are subtracted; joins
 * to unrelated tables (actors, bot profiles) are excluded, so a planner
 * choice there cannot move the total.
 */
export const discoveryRelationBuffers = (plan: DiscoveryPlan): number => {
  const children = plan.Plans ?? [];
  const own = historical(plan)
    ? blocks(plan) - children.reduce((sum, child) => sum + blocks(child), 0)
    : 0;
  return (
    own +
    children.reduce((sum, child) => sum + discoveryRelationBuffers(child), 0)
  );
};
