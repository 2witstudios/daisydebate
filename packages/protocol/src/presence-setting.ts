import { z } from 'zod';

/**
 * The status a member chooses (ADR 0103). `appearing_offline` reads as offline.
 * Away and being in a room or a Round are never chosen: they follow what the
 * member is doing.
 */
/** Where a member's active Room has them (ADR 0070). */
export type MemberPlacement = 'room' | 'round' | null;

export const chosenStatuses = ['online', 'busy', 'appearing_offline'] as const;
export type ChosenStatus = (typeof chosenStatuses)[number];

/** Everything anyone can show for a member, one vocabulary everywhere. */
export const memberStatuses = [
  'online',
  'away',
  'busy',
  'room',
  'round',
  'offline',
] as const;
export type MemberStatus = (typeof memberStatuses)[number];

export const presenceSettingSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(chosenStatuses),
});

export const presenceSettingResultSchema = z.strictObject({
  version: z.literal(1),
  status: z.enum(chosenStatuses),
});

/** Which ratings a member's card shows besides Freestyle (ADR 0103). */
export const ratingVisibilitySchema = z.strictObject({
  version: z.literal(1),
  showPolicy: z.boolean(),
  showValue: z.boolean(),
});
export type RatingVisibility = z.infer<typeof ratingVisibilitySchema>;
