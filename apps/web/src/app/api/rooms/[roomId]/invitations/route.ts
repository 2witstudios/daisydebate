import { processRoute } from '../../../../../server/process-app';
import { roomInvitationComposition } from '../../../../../features/room-invitations/composition';
type Params = Awaited<
  RouteContext<'/api/rooms/[roomId]/invitations'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  roomInvitationComposition,
  (routes) =>
    (request, { roomId }: Params) =>
      routes.invite(request, roomId),
);
