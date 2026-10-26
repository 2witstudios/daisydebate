import { assert, setupRitewayBun, test } from 'riteway/bun';
import { activeRoomNavigation } from './refresh-navigation';

setupRitewayBun();

test('client navigation rereads the shell membership without refreshing in a loop', () => {
  const paths: string[] = [];
  let path = '/rooms/owned';
  const navigate = activeRoomNavigation(() => paths.push(path));
  navigate(null);
  navigate(path);
  // The refreshed server layout still reports an active room; the pathname
  // stays the same, so adopting that answer cannot start another refresh.
  navigate(path);
  for (path of ['/settings', '/lobby', '/settings']) navigate(path);
  assert({
    given: 'a retained shell after closing, leaving or ending its active Room',
    should: 'read membership on each navigation and revisit, once per location',
    actual: paths,
    expected: ['/rooms/owned', '/settings', '/lobby', '/settings'],
  });
});
