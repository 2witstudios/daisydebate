import type { EventCompetitionFacts } from '@daisy/db/tab';
import { hostLobbyResource } from './host-lobby-resource';
import type { TabPrincipal } from '../tab-principal';

/** One results-area authority seam; participant release reads have their own projection. */
export function hostResultsAuthority(
  facts: EventCompetitionFacts,
  principal: TabPrincipal,
  now: string,
) {
  return {
    principal,
    resource: hostLobbyResource(
      facts.configuration.lobby,
      facts.authorization.organization,
      facts.ownerActorId,
    ),
    context: {
      account: facts.authorization.account,
      grants: facts.authorization.grants,
      now,
    },
  };
}
