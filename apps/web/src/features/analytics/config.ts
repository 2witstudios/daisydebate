import type { ServerConfig } from '@daisy/config';

/** Capture is offered only when the deployment can also honor vendor erasure. */
export const analyticsConfiguration = (config: ServerConfig) => {
  const host = config.NEXT_PUBLIC_POSTHOG_HOST ?? null;
  const active = Boolean(
    host && config.POSTHOG_PERSONAL_API_KEY && config.POSTHOG_PROJECT_ID,
  );
  return {
    host,
    key: active ? (config.NEXT_PUBLIC_POSTHOG_KEY ?? null) : null,
    serverKey: active ? (config.POSTHOG_API_KEY ?? null) : null,
    available: {
      analytics: active && Boolean(config.NEXT_PUBLIC_POSTHOG_KEY),
      replay: false,
    },
    managementHost:
      host === 'https://eu.i.posthog.com'
        ? 'https://eu.posthog.com'
        : 'https://us.posthog.com',
  };
};
