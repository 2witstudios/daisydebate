import { processRoute } from '../../../../server/process-app';
import { onboardingComposition } from '../../../../features/onboarding/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(
  onboardingComposition,
  (routes) => routes.POST,
);
