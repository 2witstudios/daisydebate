import { PostHog } from 'posthog-node';
import { idSchema } from '@daisy/protocol';
import { parseProductEvent, type ProductEvent } from './events';
import type { Consent } from './consent';

export type AnalyticsMessage = {
  readonly userId: string;
  readonly consent: Consent;
  readonly productEvent: ProductEvent;
};

/** One process-owned SDK, with no background SDK queue, flags or exception capture. */
export function createServerAnalytics(input: {
  readonly key: string | null;
  readonly host: string | null;
  readonly fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}) {
  const client =
    input.key && input.host
      ? new PostHog(input.key, {
          host: input.host,
          fetch: input.fetch,
          disableGeoip: true,
          flushAt: 1,
          flushInterval: 0,
          requestTimeout: 3000,
          fetchRetryCount: 0,
          enableExceptionAutocapture: false,
          disableCompression: true,
        })
      : null;
  client?.on('error', () => {});
  return {
    async track(message: AnalyticsMessage) {
      const event = parseProductEvent(
        message.productEvent.event,
        message.productEvent.properties,
      );
      if (
        !client ||
        message.consent.analytics !== 'granted' ||
        !idSchema.safeParse(message.userId).success ||
        !event
      )
        return;
      try {
        await client.captureImmediate({
          distinctId: message.userId,
          event: event.event,
          properties: {
            ...event.properties,
            userId: message.userId,
            $geoip_disable: true,
          },
          disableGeoip: true,
        });
      } catch {
        /* Optional telemetry never fails a participant operation or logs a vendor payload. */
      }
    },
    async close() {
      await client?.shutdown().catch(() => {});
    },
  };
}
