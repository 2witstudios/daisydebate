import { z } from 'zod';

/** Who may see a thing, narrowest first. Officials see everything and are not one. */
export const releaseAudiences = [
  'responsible_adults',
  'competitors',
  'participants',
  'link',
  'public',
] as const;
export const releaseAudienceSchema = z.enum(releaseAudiences);
export type ReleaseAudience = z.infer<typeof releaseAudienceSchema>;

/** The things an audience setting opens, one setting each. */
export const releaseThingSchema = z.enum([
  'posting',
  'decision',
  'scores',
  'reason',
  'feedback',
  'video',
]);
export type ReleaseThing = z.infer<typeof releaseThingSchema>;

/** When a thing opens to an audience. */
export const releaseWhenSchema = z.enum([
  'never',
  'at_once',
  'round_close',
  'prelims_end',
  'break',
  'certified',
  'manual',
]);
export type ReleaseWhen = z.infer<typeof releaseWhenSchema>;
