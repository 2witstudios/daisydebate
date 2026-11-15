import { organizationPeopleViewSchema } from '@daisy/protocol/lobby/organization-read';
import {
  organizationPeoplePage,
  organizationRailOf,
} from '../../../../../../features/tab/organization';
import { organizationPeoplePath } from '../../../../../../features/tab/organization-people-route';
import {
  requestIdentity,
  requestNow,
} from '../../../../../../lib/request-session';
import { GET as readOrganizationPeopleRoute } from '../../../../../api/tab/organization-people/route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';

/**
 * A stored league's people page for this viewer, through the route a script
 * would call; null when the viewer is not signed in as a member, or the
 * route answers not found, which it does for a viewer who may not read it.
 */
export async function readStoredPeople(
  handle: string,
  role: string | null,
  basePath: string,
) {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return null;
  const view = await readOwnRoute(
    readOrganizationPeopleRoute,
    organizationPeoplePath(handle),
    organizationPeopleViewSchema,
  );
  if (view === null) return null;
  return {
    view,
    rail: organizationRailOf(view),
    people: organizationPeoplePage(view, {
      role,
      basePath,
      viewerId: identity.principal.userId,
      now: requestNow(),
    }),
  };
}
