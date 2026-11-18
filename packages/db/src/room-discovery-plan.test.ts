import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  type DiscoveryPlan,
  discoveryRelationBuffers,
  discoveryRelationWork,
} from './room-discovery-plan.test-support';

setupRitewayBun();

test('discovery work counts history rejected by filters and repeated Room lookups', () => {
  const relation = (name: string, rows: number, loops = 1, removed = 0) => ({
    'Relation Name': name,
    'Actual Rows': rows,
    'Actual Loops': loops,
    'Rows Removed by Filter': removed,
  });
  const plan = (history = 0, rejectedPerLookup = 0) => ({
    'Actual Rows': 3,
    'Actual Loops': 1,
    Plans: [
      relation('rooms', 102, 1, history),
      {
        'Actual Rows': 3,
        'Actual Loops': 1,
        Plans: [
          relation('rounds', 102),
          relation('rooms', 1, 102, rejectedPerLookup),
          relation('actors', 10000),
        ],
      },
    ],
  });
  assert({
    given:
      'a bounded active-set plan, a historical scan and repeated filtered lookups',
    should: 'count every examined Room/Round including rejected rows and loops',
    actual: [
      plan(),
      plan(2000),
      plan(0, 20),
      { ...relation('rooms', 0), 'Rows Removed by Index Recheck': 2000 },
    ].map(discoveryRelationWork),
    expected: [306, 2306, 2346, 2000],
  });
});

test('discovery buffers count only pages the Room and Round scans touch', () => {
  const node = (
    name: string | undefined,
    hit: number,
    read: number,
    plans: readonly DiscoveryPlan[] = [],
  ): DiscoveryPlan => ({
    ...(name ? { 'Relation Name': name } : {}),
    'Actual Rows': 1,
    'Actual Loops': 1,
    'Shared Hit Blocks': hit,
    'Shared Read Blocks': read,
    Plans: plans,
  });
  const plan = (actorHits: number) =>
    node(undefined, 50 + actorHits, 4, [
      node('rooms', 9, 1, [node('room_participants', 2, 0)]),
      node(undefined, 37 + actorHits, 3, [
        node('rounds', 5, 0),
        node('rooms', 30, 3),
        node('actors', actorHits, 0),
      ]),
    ]);
  assert({
    given:
      'Room/Round scans with a nested subplan, cold reads and a varying actor join',
    should:
      'sum their own hit and read pages, excluding children and unrelated joins',
    actual: [plan(2), plan(24)].map(discoveryRelationBuffers),
    expected: [46, 46],
  });
});

test('discovery buffers attribute a bitmap index walk to its Room/Round scan', () => {
  const heap = (indexPages: number): DiscoveryPlan => ({
    'Node Type': 'Bitmap Heap Scan',
    'Relation Name': 'rooms',
    'Actual Rows': 2,
    'Actual Loops': 1,
    'Shared Hit Blocks': 6 + indexPages,
    Plans: [
      {
        'Node Type': 'BitmapAnd',
        'Actual Rows': 0,
        'Actual Loops': 1,
        'Shared Hit Blocks': indexPages,
        Plans: [
          {
            'Node Type': 'Bitmap Index Scan',
            'Actual Rows': 2,
            'Actual Loops': 1,
            'Shared Hit Blocks': indexPages,
          },
        ],
      },
    ],
  });
  assert({
    given: 'a Room bitmap heap scan whose index walk grows with history',
    should: 'count the index pages with the scan, so the growth is visible',
    actual: [heap(2), heap(200)].map(discoveryRelationBuffers),
    expected: [8, 206],
  });
});
