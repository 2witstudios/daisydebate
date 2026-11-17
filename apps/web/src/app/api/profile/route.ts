import { processRoute } from '../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.publicProfile.read);
export const PUT = processRoute((routes) => routes.publicProfile.write);
