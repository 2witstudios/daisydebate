import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.ratingVisibility.read);
export const POST = processRoute((routes) => routes.ratingVisibility.write);
