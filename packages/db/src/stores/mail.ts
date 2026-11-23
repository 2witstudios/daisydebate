import { emailDeliveryOperations } from '../email-delivery-operations';
import { mailIntentOperations } from '../mail-intents';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** Email delivery records and the mail intent queue, on the control lane. */
export const createMailStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  const control = lane('control').database;
  return namedLaneOperations({
    ...emailDeliveryOperations({ database: control, eventSink }),
    ...mailIntentOperations({ database: control, eventSink }),
  });
};
export type MailStore = ReturnType<typeof createMailStore>;
