import type { Waits } from '@daisy/clock';
import {
  openDatabaseResources,
  WORKLOAD_PROFILES,
  type DatabaseEventSink,
  type WorkloadProfile,
} from '@daisy/db/resources';
import { createAvailabilityStore } from '@daisy/db/stores/availability';
import { createChannelObservationStore } from '@daisy/db/stores/channel-observation';
import { createHealthStore } from '@daisy/db/stores/health';
import { createListenStore } from '@daisy/db/stores/listen';
import { createOutboxStore } from '@daisy/db/stores/outbox';
import { createRealtimeAuthorityStore } from '@daisy/db/stores/realtime-authority';
import type { SQL } from 'bun';

/**
 * The realtime process's database (ADR 0088): only the stores the socket
 * server reads, each on its own lane. Subscribes and renewals read authority
 * on separate lanes, so an admission wave cannot consume renewal capacity;
 * subscribe-time catch-up reads on the admission lane, never the drain's. It
 * composes no Round, Room or messaging command, so a realtime process cannot
 * spend connections on them.
 */
export function openRealtimeDatabase({
  url,
  profile = WORKLOAD_PROFILES.realtime,
  eventSink,
  client,
  waits,
}: {
  readonly url: string;
  /** The realtime profile unless the process owns observation. */
  readonly profile?: WorkloadProfile;
  readonly eventSink?: DatabaseEventSink | undefined;
  /** Overrides dialing `url` for every lane; tests inject a client at this seam. */
  readonly client?: SQL | undefined;
  /** The time lane waiters and connection bounds are measured on (R4.7). */
  readonly waits: Waits;
}) {
  const resources = openDatabaseResources({
    url,
    profile,
    eventSink,
    client,
    waits,
  });
  const listen = createListenStore(resources);
  return {
    ...createRealtimeAuthorityStore(resources, 'admission'),
    ...createRealtimeAuthorityStore(resources, 'renewal'),
    ...createChannelObservationStore(resources),
    ...createOutboxStore(resources, { catchupLane: 'admission' }),
    renewServiceInstance:
      createAvailabilityStore(resources).renewServiceInstance,
    ...createHealthStore(resources),
    listenOutbox: listen.listenOutbox,
    listenRealtimeHints: listen.listenRealtimeHints,
    close: resources.close,
  };
}
export type RealtimeDatabase = ReturnType<typeof openRealtimeDatabase>;
