import { ageStepOperations } from '../age-step';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** The age step: the member's Terms and bound birth month (ADR 0163), on the control lane. */
export const createAgeStepStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...ageStepOperations({ database: control, eventSink }),
  });
};
export type AgeStepStore = ReturnType<typeof createAgeStepStore>;
