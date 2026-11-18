import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { noopErrorReporter } from '@daisy/observability';
import {
  createHostRoundRoute,
  createHostDrawOverviewRoute,
} from '../src/features/tab/host-draw-route';
import { readHostRound } from '../src/features/tab/reads/host-round';
import { readHostDrawOverview } from '../src/features/tab/reads/host-draw-overview';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import type { Bot, World } from './tab-tournament.test-support';
/** Actual production readers and evaluated boundary, authenticated as the named real bot. */
export function hostDrawHttp(world: World, bot: Bot, released = true) {
  const store = createTabStore(world.database);
  const common = {
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => ({
        ...member,
        principal: { ...as(bot), actorId: bot.actorId },
      }),
    },
    released: async () => released,
  };
  return {
    round: createHostRoundRoute({
      ...common,
      read: readHostRound({ store, authorize }),
    }),
    overview: createHostDrawOverviewRoute({
      ...common,
      read: readHostDrawOverview({ store, authorize }),
    }),
  };
}
export const hostDrawRequest = (path: string) =>
  new Request(`${origin}${path}`);
