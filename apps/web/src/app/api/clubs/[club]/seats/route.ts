import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.billing.clubs.seats.GET);
export const POST = processRoute((routes) => routes.billing.clubs.seats.POST);
