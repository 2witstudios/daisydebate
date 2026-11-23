import { defineComposition } from '../../server/composition';
import type { App } from '../../server/app';
import { memberHttpBoundary } from '../../server/member-boundary';
import { createRoomInvitationHandlers } from './handlers';
import { endRoomInvitation, inviteToRoom } from './operations';

/** The Room invitation routes over the app's store (ADR 0124). */
function composeRoomInvitationRoutes(app: App) {
  const deps = { store: app.database, nextId: () => app.ids.next() };
  return createRoomInvitationHandlers({
    boundary: memberHttpBoundary(app),
    invite: (caller, input) => inviteToRoom(deps, caller, input),
    end: (caller, input) => endRoomInvitation(deps, caller, input),
  });
}

/** room-invitations: its route files bind here (`processRoute`). */
export const roomInvitationComposition = defineComposition(
  'room-invitations',
  (app) => composeRoomInvitationRoutes(app),
);
