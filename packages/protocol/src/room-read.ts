import { z } from 'zod';
import { usageSourceSchema } from './billing';
import { idSchema, debateRoleSchema } from './primitives';
import { formatDefinitionSchema, roundRulesSchema } from './format';
import { formatSettingsSchema } from './format-settings';
import { frozenRoomConfigSchema, frozenRoomExecutionPlanSchema } from './room';
import { roomCaptureSchema } from './room-capture';
import { competitionTypes, roundStatusSchema } from './round';
import { formatStandingSchema } from './format-standing';
import { roomStatuses } from './room-contract';
const version = z.int().positive();
const visibility = z.enum(['public', 'unlisted', 'private']);
const participant = z.strictObject({
  id: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  label: z.string(),
  consentVersion: z.int().nonnegative(),
  role: debateRoleSchema,
  slot: z.int().nonnegative(),
});
const seatState = {
  needsReady: z.boolean(),
  ready: z.enum(['ready', 'not-ready', 'unavailable']),
  eligible: z.boolean(),
};
const roundRef = z
  .strictObject({ id: idSchema, status: roundStatusSchema })
  .nullable();
/** The highest monthly AI-round cap any deploy may configure (DEC-183, ISSUE-646). */
export const AI_ROUND_MONTHLY_CAP_MAX = 1000;
/** Refusal order: the host's beta eligibility, its allowance, then global bot capacity. */
const botAdmissionRefusals = [
  'not-eligible',
  'allowance',
  'capacity',
  'renewal-grace',
] as const;
/** The closed Room refusal vocabulary every Room command and creation answers with. */
export const roomRefusalSchema = z.enum([
  'version-conflict',
  'host-required',
  'room-closed',
  'illegal-config',
  'seat-unavailable',
  'actor-ineligible',
  'not-seated',
  'incomplete-cast',
  'not-ready',
  'readiness-unavailable',
  'command-conflict',
  'consent-conflict',
  /** The caller already holds another active Room (ADR 0070). */
  'active-room',
  /** The selected catalog format, revision or preset is not available to this selection (FMT-1). */
  'format-unavailable',
  'ranked-unavailable',
  /** The draw's source cannot supply enough resolutions. */
  'draw-unavailable',
  /** Live bot-debater capacity is full; a later Launch may succeed (ISSUE-773). */
  'bots-busy',
  /** A casual AI judge needs a host holding the entitlement (WATCH-16). */
  'ai-judge-premium',
  /** A casual broadcast or recording needs a host holding the entitlement (WATCH-8). */
  'capture-premium',
  /** Too many casual captures running: for this host, or leaving room for ranked (OW4). */
  'capture-host-limit',
  'capture-capacity',
  /** A private Room admits participants alone, so it can record but not broadcast. */
  'broadcast-private',
  /** Ready on a ranked Round needs this season's signed content waiver (WATCH-15). */
  'content-waiver-required',
  'content-waiver-changed',
  /** The capture notice changed after the form showed it: read it again. */
  'capture-notice-changed',
]);
/** Full authoritative projection grammar used at JSON delivery boundaries. */
export const roomViewSchema = z.strictObject({
  id: idSchema,
  version,
  changeVersion: version,
  title: z.string().min(1),
  /** Null while a draw Room has not revealed its resolution. */
  topic: z.string().min(1).nullable(),
  visibility,
  /** Redacted to null for a viewer who may not name a judge seat the host occupies (DEC-174). */
  hostActorId: idSchema.nullable(),
  hostLabel: z.string().nullable(),
  /**
   * Host-only display of what seating an AI judge means here (WATCH-16):
   * free on ranked, included for an entitled casual host, else premium. The
   * seat command rechecks it under the host's fence. Null for anyone else.
   */
  aiJudgeSeating: z.enum(['free', 'included', 'premium']).nullable(),
  /**
   * This viewer's standing on the season's content waiver (WATCH-15), for a
   * seated human on an open ranked Room. Ready rechecks it under the Room's
   * lock. Null for anyone else.
   */
  contentWaiver: z.enum(['signed', 'unsigned']).nullable(),
  /**
   * What the host of this casual Room can choose (WATCH-8): both choices when
   * entitled, else premium, and null for ranked or anyone but the host. The
   * command rechecks it under the host's fence.
   */
  captureOffer: z.enum(['included', 'premium']).nullable(),
  /** The casual host's choice, shown to everyone before Ready. */
  capture: roomCaptureSchema.nullable(),
  /** The exact notice shown before Ready, or null when nothing is captured. */
  captureNotice: z
    .strictObject({
      version: z.string().min(1).max(64),
      text: z.string().min(1),
    })
    .nullable(),
  /**
   * For someone outside a started public Room: the Round to watch, once the
   * spectator timeline has released its start. Null for everyone else.
   */
  watchRoundId: idSchema.nullable(),
  /** Host-only display metadata; admission is rechecked atomically at freeze. */
  botAdmission: z
    .union([
      z.strictObject({ kind: z.literal('unavailable') }),
      z
        .strictObject({
          kind: z.literal('allowance'),
          /** 0 only for a host the beta does not admit to AI Rounds. */
          limit: z.int().min(0).max(AI_ROUND_MONTHLY_CAP_MAX),
          remaining: z.int().min(0).max(AI_ROUND_MONTHLY_CAP_MAX),
          source: usageSourceSchema.nullable(),
          refusal: z.enum(botAdmissionRefusals).nullable(),
        })
        .refine((allowance) => allowance.remaining <= allowance.limit),
    ])
    .nullable(),
  status: z.enum(roomStatuses),
  formatId: z.string().min(1),
  formatVersion: version,
  presetVersion: version.nullable(),
  /**
   * What the room runs and whether it is still its standard (FMT-1).
   * Viewer-safe for every reader: names, roles and a typed change list,
   * never a host-authored list or config object.
   */
  format: z.strictObject({
    name: z.string().min(1),
    role: z.enum(['standard', 'template']).nullable(),
    leagues: z.array(z.string()).readonly(),
    basis: z
      .strictObject({
        formatId: z.string().min(1),
        name: z.string().min(1),
        formatVersion: version,
        presetVersion: version,
        /** Whether the pinned basis preset strikes its resolution: Back must know. */
        strikes: z.boolean(),
      })
      .nullable(),
    standing: formatStandingSchema,
  }),
  competitionType: z.enum(competitionTypes),
  definition: formatDefinitionSchema,
  config: frozenRoomConfigSchema,
  executionPlan: frozenRoomExecutionPlanSchema,
  /** The host's own resolution list, for its author while assembling only. */
  authoredDrawSource: z
    .strictObject({ resolutions: z.array(z.string().min(1)).readonly() })
    .nullable(),
  rules: roundRulesSchema,
  /** Free debater seats this viewer may not take: held for named members (ADR 0103). */
  debaterSeatsHeldFromViewer: z.int().nonnegative(),
  participants: z
    .array(
      z.union([
        participant.extend(seatState),
        /** A human judge for a viewer who is neither that judge nor the host (DEC-174). */
        z.strictObject({
          role: z.literal('judge'),
          kind: z.literal('human'),
          slot: z.int().nonnegative(),
          anonymous: z.literal(true),
          ...seatState,
        }),
      ]),
    )
    .readonly(),
  readiness: z.strictObject({
    available: z.boolean(),
    version,
    readyActorIds: z.array(idSchema).readonly(),
  }),
  capabilities: z.strictObject({
    host: z.boolean(),
    canEdit: z.boolean(),
    canClaimSeat: z.boolean(),
    canReady: z.boolean(),
    canStart: z.boolean(),
  }),
  startRefusal: roomRefusalSchema.nullable(),
  roundRef,
});
/**
 * One format the picker offers (FMT-1): a Daisy standard or a league
 * template at its current revision and canonical preset. Structure only
 * (DEC-243): nothing here configures judging.
 */
export const roomCatalogChoiceSchema = z.strictObject({
  formatId: z.string().min(1),
  formatVersion: version,
  label: z.string(),
  role: z.enum(['standard', 'template']),
  family: z.enum(['policy', 'value', 'parli', 'other']).nullable(),
  leagues: z.array(z.string()).readonly(),
  searchTerms: z.string(),
  sortOrder: z.int(),
  rulesEdition: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  definition: formatDefinitionSchema,
  preset: z.strictObject({
    version,
    config: formatSettingsSchema,
    rankedEligible: z.boolean(),
  }),
});
/** How hard a bot debates, until the bots are specified (the Train epic). */
export const botDifficulties = [
  'beginner',
  'intermediate',
  'advanced',
] as const;
/** An AI actor a host may seat: a bot debater for a side, or the AI judge for the judge seat (ISSUE-750). */
export const roomCastChoiceSchema = z.strictObject({
  actorId: idSchema,
  label: z.string(),
  kind: z.literal('bot'),
  seatRole: z.enum(['debater', 'judge']),
  eligible: z.boolean(),
  /** The roster card's display facts; the AI judge carries none. */
  persona: z.string().optional(),
  difficulty: z.enum(botDifficulties).optional(),
});
export type RoomView = z.infer<typeof roomViewSchema>;
export type RoomCatalogChoice = z.infer<typeof roomCatalogChoiceSchema>;
export type RoomCastChoice = z.infer<typeof roomCastChoiceSchema>;
