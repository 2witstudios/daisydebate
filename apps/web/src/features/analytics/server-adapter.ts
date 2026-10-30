import { PostHog } from 'posthog-node';
import { idSchema } from '@daisy/protocol';
import { parseProductEvent, type ProductEvent } from './events';
import type { Consent } from './consent';

/** A capture failure must never fail a participant's operation or log its payload. */
export async function trackServer(input: {
  readonly key: string | null;
  readonly host: string | null;
  readonly consent: Consent;
  readonly userId: string;
  readonly productEvent: ProductEvent;
}) {
  const event = parseProductEvent(
    input.productEvent.event,
    input.productEvent.properties,
  );
  if (
    !input.key ||
    !input.host ||
    input.consent.analytics !== 'granted' ||
    !idSchema.safeParse(input.userId).success ||
    !event
  )
    return;
  const client = new PostHog(input.key, {
    host: input.host,
    disableGeoip: true,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 3000,
    fetchRetryCount: 0,
    enableExceptionAutocapture: false,
  });
  client.on('error', () => {});
  try {
    await client.captureImmediate({
      distinctId: input.userId,
      event: event.event,
      properties: {
        ...event.properties,
        userId: input.userId,
        $geoip_disable: true,
      },
      disableGeoip: true,
    });
  } catch {
    /* Analytics is best effort; raw vendor exceptions never reach logs. */
  } finally {
    await client.shutdown().catch(() => {});
  }
}
