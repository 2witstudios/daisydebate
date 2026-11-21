import { noopErrorReporter } from '@daisy/observability';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { member, origin } from '../../server/member-boundary.test-support';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createHostEventsRoute } from './host-events-route';
import { createOrganizationPeopleRoute } from './organization-people-route';
import { createTournamentSetupRoute } from './tournament-setup-route';

setupRitewayBun();

test('Tab read routes retain their validation and release order', async () => {
  const boundary = {
    logger: silentLogger,
    reporter: noopErrorReporter,
    origin: () => origin,
    identify: async () => member,
  };
  const common = {
    boundary,
    released: async () => false,
    read: async () => null,
  };
  const events = createHostEventsRoute(common);
  const setup = createTournamentSetupRoute({
    ...common,
    lobbyIdOfHandle: async () => null,
  });
  const people = createOrganizationPeopleRoute({
    ...common,
    organizationIdOfHandle: async () => null,
  });
  const responses = await Promise.all([
    events(new Request(`${origin}/api/tab/host-events`)),
    setup(new Request(`${origin}/api/tab/tournament-setup`)),
    people(new Request(`${origin}/api/tab/organization-people`)),
  ]);
  assert({
    given: 'an admitted member with an invalid query while Tab is closed',
    should:
      'keep each mounted route’s public error precedence and no-store response',
    actual: responses.map((response) => [
      response.status,
      response.headers.get('cache-control'),
    ]),
    expected: [
      [404, 'no-store'],
      [400, 'no-store'],
      [400, 'no-store'],
    ],
  });
});
