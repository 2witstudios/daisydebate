import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { TournamentsInfo } from '../ui/tournaments/tournaments-info/tournaments-info';

setupRitewayBun();

/**
 * An unnamed form has no role, so only the markup shows that the information
 * page carries none.
 */
describe('TournamentsInfo markup', () => {
  test('is information only', () => {
    assert({
      given: 'the Tournaments page',
      should: 'carry no form',
      actual: renderMarkup(h(TournamentsInfo)).includes('<form'),
      expected: false,
    });
  });
});
