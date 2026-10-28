import { processRoute } from '../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute((routes) => routes.presence.set);
export const GET = processRoute((routes) => routes.presence.read);
