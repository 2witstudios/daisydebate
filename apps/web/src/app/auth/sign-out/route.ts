import { processRoute } from '../../../server/process-app';
import { signOutComposition } from '../../../features/auth/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(signOutComposition, (routes) => routes.POST);
