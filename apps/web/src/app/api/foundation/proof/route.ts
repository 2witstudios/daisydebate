import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';

export const POST = processRoute((routes) => routes.foundationProof.POST);
export const GET = processRoute((routes) => routes.foundationProof.GET);
