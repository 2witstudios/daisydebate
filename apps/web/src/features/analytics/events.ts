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
/** Only bounded product facts. Content, URLs and participant identifiers are never event properties. */
export const productEvents = {
  page_viewed: z.strictObject({ area }),
  consent_updated: z.strictObject({ replay: z.boolean() }),
  room_created: z.strictObject({}),
  room_rematched: z.strictObject({}),
} as const;
export type ProductEventName = keyof typeof productEvents;
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

export function pageArea(pathname: string): z.infer<typeof area> | null {
  const segment = pathname.split(/[?#]/)[0]?.split('/')[1] ?? '';
  if (segment === '') return 'home';
  const result = area.safeParse(segment);
  return result.success ? result.data : null;
}
