import { processRoute } from '../../../../server/process-app';
import { usernameComposition } from '../../../../features/account/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(usernameComposition, (routes) => routes.POST);
