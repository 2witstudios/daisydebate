import { z } from 'zod';

const area = z.enum([
  'home',
  'sign-in',
  'onboarding',
  'rooms',
  'rounds',
  'ranked',
  'leaderboard',
  'settings',
  'profile',
  'prep',
  'watch',
]);
/** One viewing's quality against the WATCH-3 targets; never says what or who was watched. */
const playbackQuality = z.strictObject({
  engine: z.enum(['hlsjs', 'native']),
  startup_ms: z.int().nonnegative(),
  rebuffer_ms: z.int().nonnegative(),
  watched_ms: z.int().nonnegative(),
  height: z.int().nonnegative(),
});

/** Only bounded product facts. Content, URLs and participant identifiers are never event properties. */
const productEvents = {
  page_viewed: z.strictObject({ area }),
  consent_updated: z.strictObject({ replay: z.boolean() }),
  room_created: z.strictObject({}),
  room_rematched: z.strictObject({}),
  broadcast_playback: playbackQuality,
  recording_playback: playbackQuality,
} as const;
type ProductEventName = keyof typeof productEvents;
export type ProductEvent = {
  [K in ProductEventName]: {
    readonly event: K;
    readonly properties: z.infer<(typeof productEvents)[K]>;
  };
}[ProductEventName];

export function parseProductEvent(
  event: string,
  properties: unknown,
): ProductEvent | null {
  if (!Object.hasOwn(productEvents, event)) return null;
  const schema = productEvents[event as ProductEventName];
  const parsed = schema.safeParse(properties);
  return parsed.success
    ? ({ event, properties: parsed.data } as ProductEvent)
    : null;
}

/** SDK-generated enrichment is stripped using the same schema that admits callers. */
export function parseSdkProductEvent(
  event: string,
  properties: Record<string, unknown>,
): ProductEvent | null {
  if (!Object.hasOwn(productEvents, event)) return null;
  const schema = productEvents[event as ProductEventName];
  return parseProductEvent(
    event,
    Object.fromEntries(
      Object.keys(schema.shape).map((key) => [key, properties[key]]),
    ),
  );
}

/**
 * The product area a page path is in: the area whose `/<area>` the path is,
 * or begins as a whole segment (before a `/`, `?` or `#`). The root is home.
 */
export function pageArea(pathname: string): z.infer<typeof area> | null {
  const within = (prefix: string) =>
    pathname === prefix ||
    ['/', '?', '#'].some((next) => pathname.startsWith(prefix + next));
  if (
    ['', '/'].includes(pathname) ||
    ['?', '#', '/?', '/#'].some((root) => pathname.startsWith(root))
  )
    return 'home';
  return area.options.find((name) => within(`/${name}`)) ?? null;
}
