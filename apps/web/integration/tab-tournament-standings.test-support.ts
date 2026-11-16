import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { standings } from '@daisy/tab-engine';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { readHostStandings } from '../src/features/tab/reads/host-standings';
import { eventCompetition } from '../src/features/tab/operations/event-competition';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { World } from './tab-tournament.test-support';
import {
  createHostStandingsRoute,
  hostStandingsPath,
} from '../src/features/tab/host-standings-route';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { noopErrorReporter } from '@daisy/observability';

/** Recompute actual competitive inputs; neither standings nor break seeds are stored. */
export async function standingsStage(world: World) {
  const store = createTabStore(world.database);
  const read = readHostStandings({ store, authorize, now: world.clock.now });
  const lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!;
  const actual = await read(as(world.bots.Director!), { lobbyId, eventId });
  assert({
    given:
      'the actual completed preliminary fixtures, including an immutable correction',
    should:
      'fold current results into host standings and expose no history to an entrant or foreign event',
    actual: [
      actual?.visibility,
      actual?.visibility === 'official' ? actual.resultsVersion : null,
      actual?.rows.length,
      actual?.rows.reduce((n, row) => n + row.wins, 0),
      actual?.progress.kind,
      await read(as(world.bots['Debater 1']!), { lobbyId, eventId }),
      await read(as(world.bots.Director!), { lobbyId, eventId: createId() }),
    ],
    expected: ['official', 4, 4, 2, 'complete', null, null],
  });
  const used = await store.eventCompetition(
    { viewerUserId: world.bots.Director!.userId, lobbyId, eventId },
    async (facts) => {
      if (!facts) throw new Error('The actual event disappeared');
      return standings(
        eventCompetition(facts, {
          stageIds: facts.stages
            .filter((stage) => stage.kind === 'preliminary')
            .map((stage) => stage.id),
          cutoff: 1,
          division: null,
          seed: new TextEncoder().encode(eventId),
        }),
      ).results;
    },
  );
  const latest = [...world.made.entries()]
    .filter(([key]) => key.startsWith('result:'))
    .map(([, id]) => id)
    .sort();
  assert({
    given: 'the retained original result and its actual later correction',
    should:
      'count precisely the latest competition records without inventing ballots from projection rows',
    actual: [...used].sort(),
    expected: latest,
  });
  const route = (person: (typeof world.bots)[string], released = true) =>
    createHostStandingsRoute({
      boundary: {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          ...member,
          principal: { ...as(person), actorId: person.actorId },
        }),
      },
      released: async () => released,
      read,
    });
  const request = () =>
    new Request(`${origin}${hostStandingsPath(lobbyId, eventId)}`, {
      headers: { origin },
    });
  const response = await route(world.bots.Director!)(request());
  assert({
    given: 'the evaluated HTTP route over those same actual committed results',
    should:
      'serve the schema with no-store and conceal release/authority denials',
    actual: [
      response.status,
      response.headers.get('cache-control'),
      await response.json(),
      (await route(world.bots.Director!, false)(request())).status,
      (await route(world.bots['Debater 1']!)(request())).status,
    ],
    expected: [200, 'no-store', actual, 404, 404],
  });
}
