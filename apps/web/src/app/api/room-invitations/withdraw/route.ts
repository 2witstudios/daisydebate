import { processRoute } from '../../../../server/process-app';
import { roomInvitationComposition } from '../../../../features/room-invitations/composition';
export const runtime = 'nodejs';
export const POST = processRoute(
  roomInvitationComposition,
  (routes) => (request) => routes.end(request, 'withdraw'),
);
