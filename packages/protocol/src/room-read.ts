import { z } from 'zod';
import { idSchema } from './primitives';
import { ratingDivisions } from './ladder';
import { aiRoleSchema } from './ai-roles';
import { seatRefSchema } from './seats';
import { teamSideSchema } from './seat-draw';
import { formatDefinitionSchema, roundRulesSchema } from './format';
import { formatSettingsSchema } from './format-settings';
import { frozenRoomConfigSchema, frozenRoomExecutionPlanSchema } from './room';
import { roomCaptureSchema } from './room-capture';
import { competitionTypes, roundStatusSchema } from './round';
import { formatStandingSchema } from './format-standing';
import { isRoomRoundLink, roomStatuses } from './room-contract';
import { roomInvitationViewSchema } from './room-invitations';
const version = z.int().positive();
const visibility = z.enum(['public', 'unlisted', 'private']);
const participant = z.strictObject({
  id: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  label: z.string(),
  consentVersion: z.int().nonnegative(),
  seat: seatRefSchema,
  teamOpen: z.boolean(),
  positionOpen: z.boolean(),
  /**
   * The seated human's rating as this viewer may see it (ADR 0142): one
   * whole number, provisional until it is real. Null for a bot, or hidden.
   */
  rating: z
    .strictObject({ value: z.int(), provisional: z.boolean() })
    .nullable(),
});
const seatState = {
  needsReady: z.boolean(),
  ready: z.enum(['ready', 'not-ready', 'unavailable']),
  eligible: z.boolean(),
};
/** Where someone outside a started Room watches its Round. */
const roomWatchSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('broadcast'), roundId: idSchema }),
  z.strictObject({ kind: z.literal('live_room'), roundId: idSchema }),
]);
export type RoomWatch = z.infer<typeof roomWatchSchema>;
const roundRef = z
  .strictObject({ id: idSchema, status: roundStatusSchema })
  .nullable();
/** Refusal order: the host's eligibility, the free limit or fair-use ceiling, then global bot capacity. */
const botAdmissionRefusals = [
  'not-eligible',
  'free-limit-reached',
  'abuse-ceiling',
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
  /** The exact pinned ballot cannot run on this Room; never substitute a default. */
  'ballot-definition-unavailable',
  'ranked-unavailable',
  /**
   * The seat or Room is for the other lobby (ADR 0156): a debater seat of a
   * Room created in the other division, or a league ladder's while the
   * caller is under 18, or a Room created in a lobby the creator may not
   * open. A caller with no division (no valid age record) debates only in an
   * Open casual Room.
   */
  'other-division',
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
const roomViewFields = z.strictObject({
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
   * free (ranked, or the free bot Round's judge), included (Premium),
   * premium (the free one is used), with-bot (the free one comes only with
   * the free bot Round), not-included (the account holds no AI judging for
   * any other reason) or fair-use (today's abuse ceiling). Never a count.
   * The seat command rechecks it under the host's fence. Null for anyone else.
   */
  aiJudgeSeating: z
    .enum([
      'free',
      'included',
      'premium',
      'with-bot',
      'not-included',
      'fair-use',
    ])
    .nullable(),
  /**
   * This viewer's standing on the season's content waiver (WATCH-15), for a
   * seated human on an open ranked Room. Ready rechecks it under the Room's
   * lock. Null for anyone else.
   */
  contentWaiver: z.enum(['signed', 'unsigned']).nullable(),
  /**
   * Which waiver that standing is on: the one this viewer's own lobby signs
   * (ADR 0161), the Youth waiver for a member under 18 whatever Room they sit
   * in. Null exactly when `contentWaiver` is.
   */
  contentWaiverVersion: z.string().min(1).max(64).nullable(),
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
  /** The casual host chose to keep the call open after the Round (ADR 0127). */
  postRoundCall: z.boolean(),
  /**
   * For someone outside a started Room, where they watch its Round: the
   * Broadcast of a public one once the spectator timeline has released its
   * start, or, for a youth debater's linked coach or parent, a live Youth
   * Round's own room (ADR 0155). Null for everyone else.
   */
  watch: roomWatchSchema.nullable(),
  /** Pending invitations this viewer may see (ADR 0124). */
  invitations: z.array(roomInvitationViewSchema).max(16),
  /**
   * Host-only display metadata; admission is rechecked atomically at freeze.
   * Only the decision: never a count, limit or period (PYL-10).
   */
  botAdmission: z
    .union([
      z.strictObject({ kind: z.literal('unavailable') }),
      z.strictObject({
        kind: z.literal('allowance'),
        refusal: z.enum(botAdmissionRefusals).nullable(),
      }),
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
  /**
   * The lobby the Room was created in (ADR 0156): its debater seats are for
   * that division's members, and a ranked Round rates on its ladder.
   */
  division: z.enum(ratingDivisions),
  definition: formatDefinitionSchema,
  config: frozenRoomConfigSchema,
  executionPlan: frozenRoomExecutionPlanSchema,
  /** The host's own resolution list, for its author while assembling only. */
  authoredDrawSource: z
    .strictObject({ resolutions: z.array(z.string().min(1)).readonly() })
    .nullable(),
  rules: roundRulesSchema,
  /** Team 1's side, or null while the sides are open to the coin flip (ADR 0145). */
  teamOneSide: teamSideSchema.nullable(),
  /** Free seats of each kind this viewer may not take: held for named members (ADR 0103, ADR 0124). */
  seatsHeldFromViewer: z.strictObject({
    side: z.int().nonnegative(),
    speaker: z.int().nonnegative(),
    judge: z.int().nonnegative(),
    moderator: z.int().nonnegative(),
  }),
  participants: z
    .array(
      z.union([
        participant.extend(seatState),
        /** A human judge for a viewer who is neither that judge nor the host (DEC-174). */
        z.strictObject({
          seat: z.strictObject({
            kind: z.literal('judge'),
            slot: z.int().nonnegative(),
          }),
          kind: z.literal('human'),
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
 * One viewer's Room. Its status and its Round agree: an open Room has launched
 * none and a started Room names its Round. The parsed type stays the plain
 * shape, because the Room page keeps a finished Round beside a view it re-reads.
 */
export const roomViewSchema = roomViewFields.refine(
  (view): boolean => isRoomRoundLink(view),
  {
    message: 'A Room names a Round exactly once it has started',
    path: ['roundRef'],
  },
);

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
/** An AI actor a host may seat: a bot debater for a side's seat, or the AI judge for a judge seat (ISSUE-750). */
export const roomCastChoiceSchema = z.strictObject({
  actorId: idSchema,
  label: z.string(),
  kind: z.literal('bot'),
  /** Which AI it is, and so which seats it may hold (ISSUE-750). */
  aiRole: aiRoleSchema,
  eligible: z.boolean(),
  /** The roster card's display facts; the AI judge carries none. */
  persona: z.string().optional(),
  difficulty: z.enum(botDifficulties).optional(),
});
export type RoomView = z.infer<typeof roomViewSchema>;
export type RoomCatalogChoice = z.infer<typeof roomCatalogChoiceSchema>;
export type RoomCastChoice = z.infer<typeof roomCastChoiceSchema>;
