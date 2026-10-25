import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { replaceRoute } from './replace-route';
setupRitewayBun();

const recorder = (url: string | undefined) => {
  const calls: string[] = [];
  return {
    calls,
    router: { replace: (href: string) => void calls.push(`router ${href}`) },
    document: {
      url,
      replace: (href: string) => void calls.push(`document ${href}`),
    },
  };
};

describe('replaceRoute', () => {
  test('a media page from a non-media document', () => {
    const { calls, router, document } = recorder(
      'https://daisy.test/play/room',
    );
    replaceRoute(router, document, '/rooms/abc?notice=command-refused');
    assert({
      given: 'a document loaded as Create Room moving on to the new room',
      should:
        'load the room as a document so its own Permissions-Policy applies',
      actual: calls,
      expected: ['document /rooms/abc?notice=command-refused'],
    });
  });

  test('a media page from a media document', () => {
    const { calls, router, document } = recorder(
      'https://daisy.test/rounds/abc/room',
    );
    replaceRoute(router, document, '/rounds/abc');
    assert({
      given: 'a document loaded as a media page moving to another',
      should: 'keep the client-side navigation: the policy already applies',
      actual: calls,
      expected: ['router /rounds/abc'],
    });
  });

  test('any other page', () => {
    const { calls, router, document } = recorder('https://daisy.test/lobby');
    replaceRoute(router, document, '/rooms/abc/rematch');
    assert({
      given: 'an href to a page without the media policy',
      should: 'keep the client-side navigation',
      actual: calls,
      expected: ['router /rooms/abc/rematch'],
    });
  });
});
