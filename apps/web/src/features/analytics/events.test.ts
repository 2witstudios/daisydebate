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

  test('a viewing reports quality and nothing about who or what', () => {
    const quality = {
      engine: 'hlsjs',
      startup_ms: 800,
      rebuffer_ms: 0,
      watched_ms: 1000,
      height: 720,
    };
    assert({
      given: 'bounded playback measures',
      should: 'admit them',
      actual: parseProductEvent('broadcast_playback', quality)?.event,
      expected: 'broadcast_playback',
    });
    assert({
      given: 'a measure carrying a Round id',
      should: 'refuse it',
      actual: parseProductEvent('broadcast_playback', {
        ...quality,
        roundId: 'abc',
      }),
      expected: null,
    });
  });
});
