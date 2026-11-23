import {
  organizationPeopleViewSchema,
  type OrganizationPeopleView,
} from '@daisy/protocol/lobby/organization-read';
import { z } from 'zod';
import type { MemberBoundary } from '../auth/member-boundary';
import { bindTabRead } from './read-route';
import type { TabPrincipal } from './tab-principal';

/** The organization a host page names by its address. */
const organizationPeopleQuerySchema = z.strictObject({
  handle: z.string().trim().min(1).max(64),
});

/** Where the people read is served: `GET` with the organization's handle. */
export const organizationPeoplePath = (handle: string): string =>
  `/api/tab/organization-people?${new URLSearchParams({ handle })}`;

export type OrganizationPeopleRouteDependencies = {
  readonly boundary: MemberBoundary;
  /** Whether Daisy Tab is released to this account. */
  readonly released: (userId: string) => Promise<boolean>;
  readonly organizationIdOfHandle: (handle: string) => Promise<string | null>;
  readonly read: (
    principal: TabPrincipal,
    organizationId: string,
  ) => Promise<OrganizationPeopleView | null>;
};

/**
 * `OrganizationPeopleView` over HTTP, the read a host's people page and a
 * script call alike. A closed release, an unknown handle and a viewer the
 * evaluator does not let read the people all answer not found, so the
 * answer never tells an organization's existence to someone who may not
 * see it.
 */
export const createOrganizationPeopleRoute = (
  dependencies: OrganizationPeopleRouteDependencies,
) =>
  bindTabRead({
    boundary: dependencies.boundary,
    released: dependencies.released,
    name: 'tab.organization.people',
    query: organizationPeopleQuerySchema,
    view: organizationPeopleViewSchema,
    validateBeforeRelease: true,
    read: async (principal, { handle }) => {
      const organizationId = await dependencies.organizationIdOfHandle(handle);
      return organizationId === null
        ? null
        : dependencies.read(principal, organizationId);
    },
  });
