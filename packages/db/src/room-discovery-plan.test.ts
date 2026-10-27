import { assert, setupRitewayBun, test } from 'riteway/bun';
import { discoveryRelationWork } from './room-discovery-plan.test-support';

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
