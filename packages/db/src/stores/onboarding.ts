import { actorOperations } from '../actor-operations';
import { onboardingOperations } from '../onboarding-operations';
import { claimUsername } from '../username-claim';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Onboarding: the username claim, the member's actor and the onboarding steps, on the control lane. */
export const createOnboardingStore = (
  resources: DatabaseResources,
  { nextId }: { readonly nextId: () => string },
) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...onboardingOperations({ database: control, eventSink }),
    ...actorOperations({ database: control, eventSink }),
    /** Server-owned onboarding claim; see `claimUsername`. */
    claimUsername: (input: { userId: string; username: string }) =>
      claimUsername(control, input, nextId, eventSink),
  });
};
export type OnboardingStore = ReturnType<typeof createOnboardingStore>;
