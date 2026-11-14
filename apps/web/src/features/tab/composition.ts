import { authorize } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { memberHttpBoundary } from '../../server/member-boundary';
import {
  createOrganizationPeopleRoute,
  type OrganizationPeopleRouteDependencies,
} from './organization-people-route';
import { readOrganizationPeople } from './reads/organization-people';

/**
 * Daisy Tab's routes, over the app's Tab store and the evaluator. Each takes
 * the release check from its Next route module: release flags never reach
 * the route table the proxy loads (ADR 0118).
 */
export function composeTabRoutes(app: App) {
  const store = app.database.tabCommands;
  const now = () => app.clock.now();
  const boundary = memberHttpBoundary(app);
  const read = readOrganizationPeople({ store, authorize, now });
  return {
    organizationPeople: (
      released: OrganizationPeopleRouteDependencies['released'],
    ) =>
      createOrganizationPeopleRoute({
        boundary,
        released,
        organizationIdOfHandle: store.organizationIdOfHandle,
        read,
      }),
  };
}
