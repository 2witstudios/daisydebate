import { describe, test, assert, setupRitewayBun } from 'riteway/bun';
import { parseProductEvent, pageArea } from './events';

setupRitewayBun();
describe('product event admission', () => {
  test('closed property vocabulary', () => {
    for (const properties of [
      { area: 'home', email: 'private@example.test' },
      { area: '/rooms/private?token=secret' },
      { area: 'home', userId: 'forged' },
    ])
      assert({
        given: 'personal, arbitrary or undeclared event properties',
        should: 'reject the whole event',
        actual: parseProductEvent('page_viewed', properties),
        expected: null,
      });
    assert({
      given: 'an unregistered event',
      should: 'refuse capture',
      actual: parseProductEvent('$pageview', {}),
      expected: null,
    });
  });
  test('route classification', () => {
    assert({
      given: 'a private Room URL with a query',
      should: 'emit only the bounded product area',
      actual: pageArea('/rooms/private?secret=yes'),
      expected: 'rooms',
    });
    assert({
      given: 'an unknown route with personal content',
      should: 'omit tracking',
      actual: pageArea('/unknown/person@example.test'),
      expected: null,
    });
  });
});
