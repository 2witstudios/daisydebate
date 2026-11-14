import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import {
  guardianLinkStatuses,
  stagePlaces,
  videoAudienceCaps,
} from './vocabulary';

/**
 * A guardian's reads (TAB-5.14): their wards with the lobbies each may
 * enter, the video cap they set, the wards' entries, and an entry that
 * waits because its tournament is outside the allowed lobbies.
 */

const nameSchema = z.string().trim().min(1).max(200);
/** A lobby's or person's handle, as an address names it. */
const handleSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);

const wardSchema = z.strictObject({
  id: idSchema,
  handle: handleSchema,
  name: nameSchema,
  age: z.int().min(0).max(17),
});

const lobbyRefSchema = z.strictObject({
  id: idSchema,
  handle: handleSchema,
  name: nameSchema,
});

/** When a ward's entry runs: a day ahead, or what their day says now. */
const entryTimingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('upcoming'), startsAt: z.iso.datetime() }),
  /** The ward's day line for this entry now, such as "speaking now". */
  z.strictObject({
    kind: z.literal('today'),
    now: z.string().trim().min(1).max(200),
  }),
]);

const wardEntrySchema = z.strictObject({
  id: idSchema,
  lobby: lobbyRefSchema,
  eventName: nameSchema,
  partnerNames: z.array(nameSchema),
  /** Entered outside the allowed lobbies, so it waits for the guardian. */
  awaitingGuardian: z.boolean(),
  timing: entryTimingSchema,
});

/** An entry someone else made for a ward, waiting for the guardian. */
const wardEntryRequestSchema = z.strictObject({
  entryId: idSchema,
  ward: wardSchema.omit({ age: true }),
  lobby: lobbyRefSchema,
  startsAt: z.iso.datetime(),
  enteredBy: z.strictObject({ name: nameSchema, relation: z.literal('coach') }),
});

/** A guardian's family: what waits for them, then each ward and their entries. */
export const guardianViewSchema = z.strictObject({
  requests: z.array(wardEntryRequestSchema),
  wards: z.array(
    z.strictObject({
      ward: wardSchema,
      linkStatus: z.enum(guardianLinkStatuses),
      allowedLobbyCount: z.int().min(0),
      entries: z.array(wardEntrySchema),
      capabilities: z.strictObject({ manageAccount: z.boolean() }),
    }),
  ),
});
export type GuardianView = z.infer<typeof guardianViewSchema>;
export type WardEntry = z.infer<typeof wardEntrySchema>;

/** One ward's restriction: the lobbies they may enter and who may watch them. */
export const wardAccountViewSchema = z.strictObject({
  ward: wardSchema,
  consentedAt: z.iso.datetime(),
  /** The lobbies the guardian may allow, each with its own description. */
  lobbies: z.array(
    lobbyRefSchema.omit({ handle: true }).extend({
      description: z.string().trim().min(1).max(300).nullable(),
      allowed: z.boolean(),
    }),
  ),
  videoAudienceCap: z.enum(videoAudienceCaps),
  capabilities: z.strictObject({ manage: z.boolean() }),
});
export type WardAccountView = z.infer<typeof wardAccountViewSchema>;

/** A tournament outside the allowed lobbies that a ward's entry waits on. */
export const wardEntryRequestViewSchema = z.strictObject({
  entryId: idSchema,
  ward: wardSchema.omit({ age: true }),
  tournament: lobbyRefSchema.extend({
    startsAt: z.iso.datetime(),
    place: z.enum(stagePlaces),
    organizerName: nameSchema,
    /** Who the tournament records its rounds for. */
    recordedFor: z.enum(videoAudienceCaps),
  }),
  enteredBy: z.strictObject({
    name: nameSchema,
    relation: z.literal('coach'),
    organizationName: nameSchema,
  }),
  event: z.strictObject({
    name: nameSchema,
    /** The event's format as its host described it. */
    summary: z.string().trim().min(1).max(300),
  }),
  videoAudienceCap: z.enum(videoAudienceCaps),
  capabilities: z.strictObject({ decide: z.boolean() }),
});
export type WardEntryRequestView = z.infer<typeof wardEntryRequestViewSchema>;

export const guardianReadCatalogue = {
  GuardianView: { gate: ['guardian.link.read'] },
  WardAccountView: { gate: ['guardian.link.read'] },
  WardEntryRequestView: { gate: ['guardian.link.read'] },
} as const satisfies LobbyReadCatalogue<
  'GuardianView' | 'WardAccountView' | 'WardEntryRequestView'
>;
