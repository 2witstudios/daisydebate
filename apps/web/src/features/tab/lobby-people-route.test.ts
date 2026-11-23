import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { member, origin } from '../auth/member-boundary.test-support';
import { createLobbyPeopleRoute, lobbyPeoplePath } from './lobby-people-route';
setupRitewayBun();
const id = 'l'.repeat(24);
test('lobby People HTTP gates the release before parsing and never caches private reads', async () => {
  let reads = 0;
  let released = false;
  const get = createLobbyPeopleRoute({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member as never,
    },
    released: async () => released,
    read: async (_principal, lobbyId) => {
      reads++;
      return lobbyId === id
        ? {
            lobbyId,
            version: 3,
            name: 'Open',
            people: [],
            roles: [],
            capabilities: { give: false },
          }
        : null;
    },
  });
  const closed = await get(
    new Request(`${origin}/api/tab/lobby-people?invalid=1`),
  );
  released = true;
  const invalid = await get(
    new Request(`${origin}/api/tab/lobby-people?lobbyId=invalid`),
  );
  const allowed = await get(new Request(`${origin}${lobbyPeoplePath(id)}`));
  const denied = await get(
    new Request(`${origin}${lobbyPeoplePath('x'.repeat(24))}`),
  );
  assert({
    given:
      'closed release with malformed input, then malformed, allowed and refused lobby reads',
    should:
      'hide the closed feature, validate once released and give no-store scoped answers',
    actual: [
      closed.status,
      invalid.status,
      allowed.status,
      denied.status,
      reads,
      allowed.headers.get('cache-control'),
      (await allowed.json()).lobbyId,
    ],
    expected: [404, 400, 200, 404, 2, 'no-store', id],
  });
});
