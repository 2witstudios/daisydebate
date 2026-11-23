import { defineComposition } from '../../server/composition';
import { routeReleaseFor } from '../flags/route-release';
import { lobbyPermissionRoute } from './lobby-permission-route';
import { guardianMoreRoute } from './more-route';

/** parental-controls: its route files bind here (`processRoute`). */
export const parentalControlsComposition = defineComposition(
  'parental-controls',
  (app) => ({
    more: guardianMoreRoute(app),
    lobbyPermission: lobbyPermissionRoute(app, (id) =>
      routeReleaseFor(app)('parental-controls', id),
    ),
  }),
);
