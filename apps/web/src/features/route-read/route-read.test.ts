import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isRouteRead } from './route-read';

setupRitewayBun();

test('a route read is an RSC GET that is not a prefetch', () => {
  const read = (method: string, headers: Record<string, string>) =>
    isRouteRead(method, new Headers(headers));
  assert({
    given: 'a refresh, a prefetch, a document GET and an RSC POST',
    should: 'mark only the refresh',
    actual: [
      read('GET', { rsc: '1' }),
      read('GET', { rsc: '1', 'next-router-prefetch': '1' }),
      read('GET', {}),
      read('POST', { rsc: '1' }),
    ],
    expected: [true, false, false, false],
  });
});
