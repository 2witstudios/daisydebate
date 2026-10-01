import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getResults } from './get-results';

setupRitewayBun();

describe('getResults', () => {
  test('published, unpublished and unknown', () => {
    assert({
      given: 'a completed tournament, a live one and an unknown id',
      should: 'return results, unpublished and not-found',
      actual: [
        getResults('summer-invitational', true).kind,
        getResults('harvest-cup', true).kind,
        getResults('nope', true).kind,
      ],
      expected: ['results', 'unpublished', 'not-found'],
    });
  });

  test('a personal result only for the signed-in viewer who competed', () => {
    const mine = (id: string, signedIn: boolean) => {
      const read = getResults(id, signedIn);
      return read.kind === 'results' ? (read.data.mine?.honour ?? null) : 'x';
    };
    assert({
      given: 'signed in and out, in a tournament with and without the viewer',
      should: 'show the honour only when signed in and entered',
      actual: [
        mine('summer-invitational', true),
        mine('summer-invitational', false),
        mine('midsummer-round-robin', true),
      ],
      expected: ['Runner-up', null, null],
    });
  });
});
