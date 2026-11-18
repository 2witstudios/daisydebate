import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { entryRating } from './index';

setupRitewayBun();

describe('entry rating', () => {
  test('the mean of the members, rounded half to even', () => {
    assert({
      given: 'members 1501/61 and 1502/60, and 1500/50 and 1503/51',
      should:
        'round 1501.5 to 1502 and 60.5 to 60; 1501.5 to 1502 and 50.5 to 50',
      actual: [
        entryRating([
          { status: 'rated', rating: 1501, deviation: 61 },
          { status: 'rated', rating: 1502, deviation: 60 },
        ]),
        entryRating([
          { status: 'rated', rating: 1500, deviation: 50 },
          { status: 'rated', rating: 1503, deviation: 51 },
        ]),
      ],
      expected: [
        { status: 'rated', rating: 1502, deviation: 60 },
        { status: 'rated', rating: 1502, deviation: 50 },
      ],
    });
  });

  test('unrated unless every member is rated', () => {
    assert({
      given: 'one unrated member, and no members',
      should: 'be unrated both times',
      actual: [
        entryRating([
          { status: 'rated', rating: 1500, deviation: 50 },
          { status: 'unrated' },
        ]),
        entryRating([]),
      ],
      expected: [{ status: 'unrated' }, { status: 'unrated' }],
    });
  });
});
