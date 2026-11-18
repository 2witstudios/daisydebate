import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { simulate } from './run';

setupRitewayBun();

const seedOf = (n: number) => {
  const seed = new Uint8Array(32);
  new DataView(seed.buffer).setUint32(0, n, false);
  return seed;
};

/** The short tier of the proof: small tournaments, every draw handed to the checker. */
const reports = Array.from({ length: 24 }, (_, n) => simulate(seedOf(n + 1)));

describe('simulated tournaments', () => {
  test('every draw of every tournament is accepted by the checker', () => {
    assert({
      given:
        '24 seeded tournaments with events sharing slots, divisions, drops, late results, judge shortages, re-draws and corrections',
      should: 'have no answer the independent checker refuses',
      actual: reports.flatMap((r) =>
        r.rejections.map(
          (x) =>
            `${r.seed.slice(0, 8)} ${x.where}: ${JSON.stringify(x.violations).slice(0, 300)}`,
        ),
      ),
      expected: [],
    });
  });

  test('at least half of them have two or more events sharing slots', () => {
    assert({
      given: 'the short tier',
      should:
        'run at least half its tournaments with several events in one slot',
      actual: reports.filter((r) => r.sharedSlots).length * 2 >= reports.length,
      expected: true,
    });
  });

  test('the corpus reaches every kind of answer the scenarios provoke', () => {
    const kinds = new Set(reports.flatMap((r) => Object.keys(r.answers)));
    assert({
      given: 'the short tier',
      should: 'include drawn answers and infeasible slots and panels',
      actual: ['drawn', 'infeasible:panels', 'infeasible:slot'].filter((k) =>
        kinds.has(k),
      ),
      expected: ['drawn', 'infeasible:panels', 'infeasible:slot'],
    });
  });
});
