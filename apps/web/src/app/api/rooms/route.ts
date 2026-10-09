import { processRoute } from '../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processRoute((routes) => routes.rooms.list);
export const POST = processRoute((routes) => routes.rooms.create);
