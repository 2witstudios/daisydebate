import { createAuthRouteHandlers } from '../../../../features/auth/handlers';
import { getAuth } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handlers = createAuthRouteHandlers(() => getAuth().instance);
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
