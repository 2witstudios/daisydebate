import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PROVISIONAL_AFTER, rankEntries } from './standing';
import { entry } from './standing.test-support';

setupRitewayBun();

describe('rankEntries', () => {
  test('ranks established debaters only, in rating order', () => {
    const ranked = rankEntries([
      entry({ id: 'a', rating: 1500 }),
      entry({ id: 'p', rating: 1800, played: PROVISIONAL_AFTER - 1 }),
      entry({ id: 'b', rating: 1600 }),
    ]);
    assert({
      given: 'a provisional debater rated above two established ones',
      should: 'list them by rating but rank only the established two',
      actual: ranked.map((row) => [row.id, row.rank, row.provisional]),
      expected: [
        ['p', null, true],
        ['b', 1, false],
        ['a', 2, false],
      ],
    });
  });

  test('ties', () => {
    assert({
      given: 'two debaters with the same rating',
      should: 'order them by id so the ranks are stable',
      actual: rankEntries([
        entry({ id: 'b', rating: 1500 }),
        entry({ id: 'a', rating: 1500 }),
      ]).map((row) => row.id),
      expected: ['a', 'b'],
    });
  });

  test('derived fields', () => {
    const [top, prov] = rankEntries([
      entry({ id: 'a', rating: 1720, played: 20, wins: 15 }),
      entry({ id: 'p', rating: 1400, played: 4, wins: 1 }),
    ]);
    assert({
      given: 'an established and a provisional entry',
      should:
        'derive the losses and carry no bloom band (debaters have no tiers)',
      actual: [
        top?.losses,
        prov?.losses,
        top && 'bloom' in top,
        prov && 'bloom' in prov,
      ],
      expected: [5, 3, false, false],
    });
  });

  test('input order is kept', () => {
    const input = [
      entry({ id: 'b', rating: 1 }),
      entry({ id: 'a', rating: 2 }),
    ];
    rankEntries(input);
    assert({
      given: 'an input array',
      should: 'not reorder the caller’s array',
      actual: input.map((row) => row.id),
      expected: ['b', 'a'],
    });
  });
});
