import { processRoute } from '../../../../server/process-app';
import { contactComposition } from '../../../../features/contacts/composition';
export const runtime = 'nodejs';
export const POST = processRoute(
  contactComposition,
  (routes) => routes.blockByUsername,
);
