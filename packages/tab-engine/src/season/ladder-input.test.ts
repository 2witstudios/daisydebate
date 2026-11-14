import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Id, ResultOf, TwoSides } from '../shapes/competition';
import type { LadderGame, LadderInput } from '../shapes/folds';
import { ladderInput } from './index';

setupRitewayBun();

describe('ladder input', () => {
  const room: LadderGame = {
    result: 'room-1',
    source: 'league_room',
    playedAt: '2026-03-02',
    sides: [['p1'], ['p2']],
    winner: 1,
  };
  const pairing = (a: Id, b: Id) => ({
    kind: 'pairing' as const,
    sides: [a, b] as const,
    panel: [],
  });
  const result = (
    id: Id,
    fixture: Id,
    winner: Id | null,
    over: Partial<ResultOf<TwoSides>> = {},
  ): ResultOf<TwoSides> => ({
    id,
    fixture,
    kind: 'decided',
    supersedes: null,
    certified: true,
    outcome: { kind: 'winner', winner, ballots: [] },
    ...over,
  });
  const tournament = (
    sanctioned: boolean,
  ): LadderInput['tournaments'][number] => ({
    event: sanctioned ? 'T1' : 'T2',
    sanctioned,
    entries: [
      { id: 'x', members: ['p1', 'p3'] },
      { id: 'y', members: ['p2', 'p4'] },
    ],
    results: [
      {
        result: result('g1', 'f1', 'y'),
        fixture: pairing('x', 'y'),
        playedAt: '2026-03-01',
      },
      {
        result: result('g2', 'f2', 'x'),
        fixture: pairing('x', 'y'),
        playedAt: '2026-03-03',
      },
      {
        result: result('g2b', 'f2', 'y', { supersedes: 'g2' }),
        fixture: pairing('x', 'y'),
        playedAt: '2026-03-03',
      },
      {
        result: result('g3', 'f3', 'x', { certified: false }),
        fixture: pairing('x', 'y'),
        playedAt: '2026-03-04',
      },
      {
        result: result('g4', 'f4', 'x', { kind: 'administrative' }),
        fixture: pairing('x', 'y'),
        playedAt: '2026-03-05',
      },
      {
        result: result('g5', 'f5', null),
        fixture: pairing('x', 'y'),
        playedAt: '2026-03-06',
      },
    ],
  });

  test('rooms and the ratable games of sanctioned tournaments, in play order', () => {
    assert({
      given: 'a league room, a sanctioned tournament and an unsanctioned one',
      should:
        'emit the certified decided latest corrections with a winner, by played time',
      actual: ladderInput({
        rooms: [room],
        tournaments: [tournament(true), tournament(false)],
      }),
      expected: [
        {
          result: 'g1',
          source: 'tournament',
          playedAt: '2026-03-01',
          sides: [
            ['p1', 'p3'],
            ['p2', 'p4'],
          ],
          winner: 1,
        },
        room,
        {
          result: 'g2b',
          source: 'tournament',
          playedAt: '2026-03-03',
          sides: [
            ['p1', 'p3'],
            ['p2', 'p4'],
          ],
          winner: 1,
        },
      ],
    });
  });
});
