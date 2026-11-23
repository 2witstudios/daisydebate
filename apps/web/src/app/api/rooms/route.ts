import { processRoute } from '../../../server/process-app';
import { roomComposition } from '../../../features/room-runtime/composition';
export const runtime = 'nodejs';
export const GET = processRoute(roomComposition, (routes) => routes.list);
export const POST = processRoute(roomComposition, (routes) => routes.create);
