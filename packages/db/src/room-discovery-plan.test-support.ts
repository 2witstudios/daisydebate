export type DiscoveryPlan = {
  readonly 'Node Type'?: string;
  readonly 'Relation Name'?: string;
  readonly 'Actual Rows': number;
  readonly 'Actual Loops': number;
  readonly 'Rows Removed by Filter'?: number;
  readonly 'Rows Removed by Index Recheck'?: number;
  readonly 'Shared Hit Blocks'?: number;
  readonly 'Shared Read Blocks'?: number;
  readonly Plans?: readonly DiscoveryPlan[];
};

const isRoomOrRoundScan = (plan: DiscoveryPlan) =>
  ['rooms', 'rounds'].includes(plan['Relation Name'] ?? '');

/** Sums a per-node measure over every Room/Round scan in a plan tree. */
const sumRoomRoundScans = (
  plan: DiscoveryPlan,
  own: (scan: DiscoveryPlan) => number,
): number =>
  (isRoomOrRoundScan(plan) ? own(plan) : 0) +
  (plan.Plans ?? []).reduce(
    (sum, child) => sum + sumRoomRoundScans(child, own),
    0,
  );

/** Physical Room/Round work includes rejected rows, not just returned candidates. */
export const discoveryRelationWork = (plan: DiscoveryPlan): number =>
  sumRoomRoundScans(
    plan,
    (scan) =>
      (scan['Actual Rows'] +
        (scan['Rows Removed by Filter'] ?? 0) +
        (scan['Rows Removed by Index Recheck'] ?? 0)) *
      scan['Actual Loops'],
  );

const blocks = (plan: DiscoveryPlan) =>
  (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);

// A Bitmap Heap Scan's index walk is a child node with no relation name; its
// pages belong to the scan, so they are not subtracted.
const ownIndexWalk = (child: DiscoveryPlan) =>
  ['Bitmap Index Scan', 'BitmapAnd', 'BitmapOr'].includes(
    child['Node Type'] ?? '',
  );

/**
 * Pages the Room/Round scans themselves touched, hit or read, so index pages
 * walked past without yielding a row still count, bitmap index walks
 * included. EXPLAIN reports buffers inclusive of child nodes, so each scan's
 * other children (subplans that are measured on their own) are subtracted;
 * joins to unrelated tables (actors, bot profiles) are excluded, so a planner
 * choice there cannot move the total.
 */
export const discoveryRelationBuffers = (plan: DiscoveryPlan): number =>
  sumRoomRoundScans(
    plan,
    (scan) =>
      blocks(scan) -
      (scan.Plans ?? [])
        .filter((child) => !ownIndexWalk(child))
        .reduce((sum, child) => sum + blocks(child), 0),
  );
