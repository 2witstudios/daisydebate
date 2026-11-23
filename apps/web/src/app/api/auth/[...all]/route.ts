import { processRoute } from '../../../../server/process-app';
import { authComposition } from '../../../../features/auth/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = processRoute(authComposition, (routes) => routes.GET);
export const POST = processRoute(authComposition, (routes) => routes.POST);
export const PATCH = processRoute(authComposition, (routes) => routes.PATCH);
export const PUT = processRoute(authComposition, (routes) => routes.PUT);
export const DELETE = processRoute(authComposition, (routes) => routes.DELETE);
