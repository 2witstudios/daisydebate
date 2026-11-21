import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type { TabStore } from '@daisy/db/tab';
import type { TabPrincipal } from '../tab-principal';

export async function readStandingLobbyManagement(
  dependencies: {
    readonly store: Pick<TabStore, 'standingLobbyManagement'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: string;
  },
  principal: TabPrincipal,
  organizationId: string,
) {
  return dependencies.store.standingLobbyManagement(
    { organizationId, viewerUserId: principal.userId },
    async (facts, read) => {
      if (!facts) return null;
      const { authority, name } = facts;
      const resource = authority.organization;
      if (resource?.organizationKind !== 'league') return null;
      const input = {
        principal,
        resource,
        context: {
          account: authority.account,
          grants: authority.grants,
          now: dependencies.now,
        },
      };
      if (
        !dependencies.authorize({
          ...input,
          capability: 'organization.host.read',
        }).allow
      )
        return null;
      return {
        name,
        organizationId,
        today: dependencies.now.slice(0, 10),
        canManage: dependencies.authorize({
          ...input,
          capability: 'organization.manage',
        }).allow,
        lobbies: await read(),
      };
    },
  );
}

export type StandingLobbyManagement = NonNullable<
  Awaited<ReturnType<typeof readStandingLobbyManagement>>
>;
