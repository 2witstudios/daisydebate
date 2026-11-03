import { processRoute } from '../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.challenges.list);
export const POST = processRoute((routes) => routes.challenges.send);
