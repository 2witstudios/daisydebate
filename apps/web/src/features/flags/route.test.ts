import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireReleaseRoute } from './route';

setupRitewayBun();
test('a dark release route uses the actual Next 404 boundary', async () => {
  const dark = await Promise.allSettled([
    requireReleaseRoute(async () => false, 'premium-checkout', null),
  ]);
  const open = await Promise.allSettled([
    requireReleaseRoute(async () => true, 'premium-checkout', null),
  ]);
  const result = dark[0]!;
  assert({
    given: 'the route adapter with closed and open release decisions',
    should: 'throw Next HTTP 404 only for the closed route',
    actual: {
      dark: result.status === 'rejected' ? result.reason.digest : null,
      open: open[0]!.status,
    },
    expected: { dark: 'NEXT_HTTP_ERROR_FALLBACK;404', open: 'fulfilled' },
  });
});
