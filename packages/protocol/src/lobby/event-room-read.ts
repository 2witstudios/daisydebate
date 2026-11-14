import { z } from 'zod';
import { idSchema } from '../primitives';
import { dayStateSchema } from './day-read';
import { tabRoundRefSchema } from './lobby-read';
import type { LobbyReadCatalogue } from './read';
import { resolvedSettingSourceSchema } from './resolved-settings-read';

/**
 * An event Room before its Round starts (TAB-5.14): the published fixture it
 * holds, who has arrived in its seats, and what publishing pinned on it with
 * the scope that set it. Its seats are the fixture's and never change here.
 */

const name = z.string().trim().min(1).max(200);
const instant = z.iso.datetime();
const count = z.int().nonnegative();

/** The values publishing pinned on the Room, as one line each. */
export const pinnedSettingLines = [
  'format',
  'resolution',
  'decision',
  'ballots',
  'recording',
] as const;
export type PinnedSettingLine = (typeof pinnedSettingLines)[number];

export const eventRoomEntrySchema = z.strictObject({
  entryId: idSchema,
  name,
  /** The side or position as the format names it; null in a section. */
  side: name.nullable(),
  /** Shown in an elimination round. */
  seed: z.int().positive().nullable(),
  school: name.nullable(),
  /** A team's members, by name; `own` marks the viewer. */
  members: z.array(z.strictObject({ name, own: z.boolean() })).max(8),
  /** In a section: where the entry speaks. */
  speaks: z.int().positive().nullable(),
  /** Of the entry's people, how many are in the Room. */
  present: count,
  of: z.int().positive(),
  /** The viewer's own entry. */
  own: z.boolean(),
});
export type EventRoomEntry = z.infer<typeof eventRoomEntrySchema>;

export const eventRoomJudgeSchema = z.strictObject({
  name,
  chair: z.boolean(),
  present: z.boolean(),
  /** The viewer judges in this seat. */
  own: z.boolean(),
});

export const eventRoomQuerySchema = z.strictObject({ roomId: idSchema });

export const eventRoomViewSchema = z.strictObject({
  roomId: idSchema,
  fixtureId: idSchema,
  lobby: z.strictObject({
    lobbyId: idSchema,
    handle: z.string().regex(/^[a-z0-9-]{1,64}$/),
    name,
  }),
  asOf: instant,
  event: z.strictObject({ eventId: idSchema, name }),
  tabRound: tabRoundRefSchema,
  kind: z.enum(['pairing', 'section']),
  roomName: name,
  opensAt: instant,
  state: dayStateSchema,
  /** In position order. */
  entries: z.array(eventRoomEntrySchema).min(1).max(12),
  judges: z.array(eventRoomJudgeSchema).max(9),
  /**
   * What publishing pinned, with where it came from. Each line is the
   * resolved setting's value as the settings read renders it.
   */
  pinned: z.strictObject({
    source: resolvedSettingSourceSchema,
    lines: z
      .array(
        z.strictObject({
          line: z.enum(pinnedSettingLines),
          text: z.string().trim().min(1).max(400),
        }),
      )
      .max(pinnedSettingLines.length),
  }),
  capabilities: z.strictObject({
    /** The viewer may open their ballot here. */
    ballot: z.boolean(),
  }),
});
export type EventRoomView = z.infer<typeof eventRoomViewSchema>;

export const eventRoomReadCatalogue = {
  EventRoomView: { gate: ['room.read'] },
} as const satisfies LobbyReadCatalogue<'EventRoomView'>;
