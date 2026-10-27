import { processRoute } from '../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.friends.list);
export const POST = processRoute((routes) => routes.friends.request);
