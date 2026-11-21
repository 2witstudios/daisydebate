import {
  authorizedHostAreas,
  type AuthorizationInput,
  type AuthorizationDecision,
} from '@daisy/auth/authorization';
import { EventSettingParentsChanged, type TabStore } from '@daisy/db/tab';
import { idSchema } from '@daisy/protocol';
import { hostNavigationViewSchema } from '@daisy/protocol/lobby/host-navigation-read';
import { hostLobbyResource } from '../operations/host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

export const readHostNavigation =
  (dependencies: {
    readonly store: Pick<TabStore, 'hostNavigation'>;
    readonly authorize: (input: AuthorizationInput) => AuthorizationDecision;
    readonly now: () => string;
  }) =>
  async (
    principal: TabPrincipal,
    target: { readonly kind: 'organization' | 'lobby'; readonly id: string },
  ) => {
    if (!idSchema.safeParse(target.id).success) return null;
    try {
      return await dependencies.store.hostNavigation(
        { viewerUserId: principal.userId, target },
        async (facts) => {
          if (!facts) return null;
          const resource =
            facts.kind === 'organization'
              ? facts.authorization.organization
              : hostLobbyResource(
                  facts.lobby,
                  facts.authorization.organization,
                  facts.ownerActorId,
                );
          if (!resource) return null;
          if (resource.kind !== 'organization' && resource.kind !== 'lobby')
            return null;
          const authority = {
            principal,
            resource,
            context: {
              account: facts.authorization.account,
              grants: facts.authorization.grants,
              now: dependencies.now(),
            },
          };
          const shell =
            facts.kind === 'organization'
              ? 'organization.host.read'
              : 'lobby.host.read';
          if (
            !dependencies.authorize({ ...authority, capability: shell }).allow
          )
            return null;
          const entity =
            facts.kind === 'organization' ? facts.organization : facts.lobby;
          const areas = authorizedHostAreas(authority);
          const schedule =
            facts.kind === 'lobby' && areas.includes('lobby.host.draw.read')
              ? await facts.readSchedule()
              : null;
          return hostNavigationViewSchema.parse({
            kind: facts.kind,
            id: entity.id,
            handle: entity.handle,
            name: entity.name,
            areas,
            ...(schedule
              ? {
                  schedule: {
                    slots: schedule.slots.map((slot) => ({
                      ...slot,
                      startsAt: slot.startsAt.toISOString(),
                    })),
                    rounds: schedule.rounds,
                  },
                }
              : {}),
            manageSetup: dependencies.authorize({
              ...authority,
              capability:
                facts.kind === 'organization'
                  ? 'organization.manage'
                  : 'lobby.setup.manage',
            }).allow,
            events: facts.kind === 'lobby' ? facts.events : [],
          });
        },
      );
    } catch (error) {
      if (error instanceof EventSettingParentsChanged) return null;
      throw error;
    }
  };
