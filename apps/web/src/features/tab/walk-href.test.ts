import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { walkHref } from './walk-href';
setupRitewayBun();
describe('walk navigation', () => {
  test('preview addresses are isolated and idempotent', () => {
    const paths = [
      '/tournaments?view=calendar',
      '/host/tournaments/autumn-open/setup',
      '/rooms/sample/room/live',
      '/tournaments/walk/host',
      '/sign-in',
      '/lobby',
      'https://example.org/',
    ];
    assert({
      given: 'preview links and ordinary product destinations',
      should:
        'prefix only preview destinations once, preserving queries and external links',
      actual: paths.map((path) => walkHref(walkHref(path))),
      expected: [
        '/tournaments/walk/directory?view=calendar',
        '/tournaments/walk/host/tournaments/autumn-open/setup',
        '/tournaments/walk/rooms/sample/room/live',
        '/tournaments/walk/host',
        '/sign-in',
        '/lobby',
        'https://example.org/',
      ],
    });
  });
});
