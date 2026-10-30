import posthog from 'posthog-js';
import { idSchema } from '@daisy/protocol';
import { parseProductEvent, type ProductEvent } from './events';
import type { Consent } from './consent';

let initialized = false;
let currentUser: string | null = null;
let paused = true;

/** Drops SDK enrichment too: filtering only caller properties would still leak URLs and referrers. */
export function sanitizeCapture(
  event: { event: string; properties: Record<string, unknown> } | null,
) {
  if (!event) return null;
  const { distinct_id, $anon_distinct_id } = event.properties;
  if (typeof distinct_id !== 'string') return null;
  if (event.event === '$identify')
    return {
      ...event,
      properties: {
        distinct_id,
        $anon_distinct_id,
        $set: {},
        $set_once: {},
        $geoip_disable: true,
      },
    };
  const parsed = parseProductEvent(
    event.event,
    Object.fromEntries(
      Object.entries(event.properties).filter(
        ([key]) => key === 'area' || key === 'replay',
      ),
    ),
  );
  if (!parsed) return null;
  return {
    ...event,
    properties: {
      ...parsed.properties,
      distinct_id,
      ...(currentUser ? { userId: currentUser } : { anonymousId: distinct_id }),
      $geoip_disable: true,
    },
  };
}

export function syncAnalytics(input: {
  readonly key: string | null;
  readonly host: string | null;
  readonly consent: Consent;
  readonly userId: string | null;
}) {
  if (!input.key || !input.host || input.consent.analytics !== 'granted') {
    paused = true;
    // Removing optional storage is necessary even on a fresh document where
    // initializing the SDK would violate the visitor's refused consent.
    if (typeof document !== 'undefined')
      document.cookie = 'ph_daisy_analytics=; Path=/; Max-Age=0; SameSite=Lax';
    if (initialized) {
      posthog.stopSessionRecording();
      posthog.reset();
      posthog.opt_out_capturing();
    }
    currentUser = null;
    return;
  }
  if (!initialized) {
    posthog.init(input.key, {
      api_host: input.host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_compression: true,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      opt_out_capturing_by_default: true,
      persistence: 'memory',
      persistence_name: 'daisy_analytics',
      cross_subdomain_cookie: false,
      secure_cookie: true,
      person_profiles: 'identified_only',
      ip: false,
      save_referrer: false,
      store_google: false,
      before_send: (event) => {
        if (paused) return null;
        const sanitized = sanitizeCapture(event);
        return event && sanitized
          ? { ...event, properties: sanitized.properties }
          : null;
      },
    });
    initialized = true;
  }
  const userId =
    input.userId && idSchema.safeParse(input.userId).success
      ? input.userId
      : null;
  const persistedUser = posthog.get_property('$user_id');
  if (
    (currentUser && currentUser !== userId) ||
    (typeof persistedUser === 'string' && persistedUser !== userId)
  )
    posthog.reset();
  currentUser = userId;
  paused = false;
  posthog.set_config({ persistence: 'cookie' });
  posthog.opt_in_capturing({ captureEventName: false });
  if (userId && posthog.get_distinct_id() !== userId) posthog.identify(userId);
}

export function trackClient(event: ProductEvent) {
  const parsed = parseProductEvent(event.event, event.properties);
  if (initialized && !paused && !posthog.has_opted_out_capturing() && parsed)
    posthog.capture(parsed.event, parsed.properties);
}

export function stopAnalytics() {
  paused = true;
  if (initialized) {
    posthog.stopSessionRecording();
  }
}
