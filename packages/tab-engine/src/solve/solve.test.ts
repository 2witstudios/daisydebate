import { wordStream } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { minimumCostAssignment } from './assignment';
import { maximumFlow } from './flow';
import { compareVectors, packLexicographic } from './lexicographic';
import { minimumCostPerfectMatching, type WeightedEdge } from './matching';

setupRitewayBun();

const numbers = (label: string, seed: number) => {
  const stream = wordStream(`tab-engine-test/${label}`, new Uint8Array([seed]), new Uint8Array());
  let at = 0;
  return (below: number) => {
    const word = stream(at);
    at += 1;
    return word % below;
  };
};

/** Every perfect matching's cost by trying them all; null when none exists. */
const bruteMatching = (n: number, cost: Map<string, bigint>): bigint | null => {
  const best = (free: readonly number[]): bigint | null => {
    if (free.length === 0) return 0n;
    const [first, ...rest] = free;
    let least: bigint | null = null;
    for (const partner of rest) {
      const edge = cost.get(`${first}-${partner}`);
      if (edge === undefined) continue;
      const remainder = best(rest.filter((v) => v !== partner));
      if (remainder === null) continue;
      if (least === null || edge + remainder < least) least = edge + remainder;
    }
    return least;
  };
  return best(Array.from({ length: n }, (_, i) => i));
};

const matchingCost = (mate: readonly number[], cost: Map<string, bigint>) =>
  mate.reduce(
    (sum, partner, v) => (v < partner ? sum + cost.get(`${v}-${partner}`)! : sum),
    0n,
  );

describe('minimum-cost perfect matching', () => {
  test('equals the brute-force minimum on every small graph tried', () => {
    const mismatches: string[] = [];
    for (let seed = 0; seed < 240; seed += 1) {
      const next = numbers('matching', seed);
      const n = 2 + 2 * (seed % 5);
      const density = 40 + next(61);
      const cost = new Map<string, bigint>();
      const edges: WeightedEdge[] = [];
      for (let i = 0; i < n; i += 1)
        for (let j = i + 1; j < n; j += 1)
          if (next(100) < density) {
            const c = BigInt(next(seed % 3 === 0 ? 4 : 50));
            cost.set(`${i}-${j}`, c);
            edges.push([i, j, c]);
          }
      const expected = bruteMatching(n, cost);
      const mate = minimumCostPerfectMatching(n, edges);
      const actual = mate === null ? null : matchingCost(mate, cost);
      const consistent = mate === null || mate.every((p, v) => mate[p] === v);
      if (actual !== expected || !consistent) mismatches.push(`seed ${seed}`);
    }
    assert({
      given: '240 seeded graphs of 2 to 10 vertices, sparse to complete',
      should: 'cost exactly the brute-force minimum, or report no perfect matching',
      actual: mismatches,
      expected: [],
    });
  });

  test('an odd vertex count has no perfect matching', () => {
    assert({
      given: 'three vertices joined in a triangle',
      should: 'report none',
      actual: minimumCostPerfectMatching(3, [
        [0, 1, 1n],
        [1, 2, 1n],
        [0, 2, 1n],
      ]),
      expected: null,
    });
  });
});

const bruteAssignment = (costs: readonly (readonly (bigint | null)[])[]): bigint | null => {
  const best = (row: number, used: ReadonlySet<number>): bigint | null => {
    if (row === costs.length) return 0n;
    let least: bigint | null = null;
    costs[row]!.forEach((c, column) => {
      if (c === null || used.has(column)) return;
      const rest = best(row + 1, new Set([...used, column]));
      if (rest !== null && (least === null || c + rest < least)) least = c + rest;
    });
    return least;
  };
  return best(0, new Set());
};

describe('minimum-cost assignment', () => {
  test('equals the brute-force minimum on every small table tried', () => {
    const mismatches: string[] = [];
    for (let seed = 0; seed < 240; seed += 1) {
      const next = numbers('assignment', seed);
      const rows = 1 + (seed % 5);
      const columns = rows + next(3);
      const costs = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, () => (next(100) < 25 ? null : BigInt(next(30)))),
      );
      const expected = bruteAssignment(costs);
      const assigned = minimumCostAssignment(costs);
      const actual =
        assigned === null ? null : assigned.reduce((sum, column, row) => sum + costs[row]![column]!, 0n);
      const distinct = assigned === null || new Set(assigned).size === assigned.length;
      if (actual !== expected || !distinct) mismatches.push(`seed ${seed}`);
    }
    assert({
      given: '240 seeded tables of up to 5 rows, some pairs forbidden',
      should: 'cost exactly the brute-force minimum, or report no assignment',
      actual: mismatches,
      expected: [],
    });
  });
});

describe('maximum flow', () => {
  test('a bottleneck limits the flow and the cut sits behind it', () => {
    const answer = maximumFlow(
      {
        nodes: 4,
        arcs: [
          { from: 0, to: 1, capacity: 3 },
          { from: 0, to: 2, capacity: 2 },
          { from: 1, to: 3, capacity: 1 },
          { from: 2, to: 3, capacity: 5 },
        ],
      },
      0,
      3,
    );
    assert({
      given: 'a source with arcs of 3 and 2 to a sink through arcs of 1 and 5',
      should: 'carry 3, with node 1 on the source side of the cut',
      actual: [answer.value, answer.reachable[1], answer.reachable[3]],
      expected: [3, true, false],
    });
  });
});

describe('lexicographic packing', () => {
  test('a lower field never outweighs a higher one', () => {
    const vectors = [
      [0, 9, 9],
      [1, 0, 0],
      [0, 9, 8],
    ];
    const packed = packLexicographic(vectors, 4);
    const byPacked = [0, 1, 2].sort((a, b) => (packed[a]! < packed[b]! ? -1 : 1));
    const byVector = [0, 1, 2].sort((a, b) => compareVectors(vectors[a]!, vectors[b]!));
    assert({
      given: 'three vectors whose lower fields are large',
      should: 'order the packed weights exactly as the vectors order',
      actual: byPacked,
      expected: byVector,
    });
  });
});
