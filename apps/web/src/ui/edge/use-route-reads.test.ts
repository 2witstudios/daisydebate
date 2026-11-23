import { assert, setupRitewayBun, test } from 'riteway/bun';
import { routeReadOf } from './use-route-reads';

setupRitewayBun();

const page = {
  href: 'https://daisy.test/messages/c1',
  origin: 'https://daisy.test',
};
const read = (initiatorType: string, name: string) =>
  routeReadOf({ initiatorType, name }, page)?.url.pathname ?? null;

test('a route read is a same-origin fetch carrying the App Router query', () => {
  assert({
    given:
      'an RSC refresh, a server action post, a cross-origin RSC fetch, a script and a relative RSC fetch',
    should: 'count only the same-origin RSC fetches',
    actual: [
      read('fetch', 'https://daisy.test/messages/c1?_rsc=abc'),
      read('fetch', 'https://daisy.test/messages/c1'),
      read('fetch', 'https://elsewhere.test/messages/c1?_rsc=abc'),
      read('script', 'https://daisy.test/messages/c1?_rsc=abc'),
      read('fetch', '/messages/c2?_rsc=def'),
    ],
    expected: ['/messages/c1', null, null, null, '/messages/c2'],
  });
});
