import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.reports.notices);
export const POST = processRoute((routes) => routes.reports.acknowledge);
