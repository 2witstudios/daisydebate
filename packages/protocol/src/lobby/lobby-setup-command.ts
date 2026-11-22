import { isInstantBefore } from '@daisy/clock';
import { roomConfigSchema } from '../room';
import { z } from 'zod';
import { idSchema } from '../primitives';
import {
  ballotDefinitionPinSchema,
  ballotDefinitionBodySchema,
} from '../ballot-definition';
import { roomCreateSchema } from '../room-contract';
import { lobbyAgeRules } from './eligibility';
import {
  lobbyCommandEnvelope,
  type LobbyCommandCatalogue,
  type LobbyCommandDefinition,
} from './command';
import {
  entryKinds,
  seasonCountings,
  stageKinds,
  stagePlaces,
  tournamentStatuses,
  type TournamentStatus,
} from './vocabulary';

/**
 * The lobby and season commands, creating a Room in a standing lobby, and
 * a tournament's setup: events, stages, tab rounds, time slots, placing a
 * tab round, ballot definitions and resolutions (TAB-5.10).
 */

// ---------------------------------------------------------------------------
// The tournament lifecycle. Its predicates live here, once, beside the
// commands that move it; nothing else re-spells the order.

/** The statuses `set-tournament-status` may move to; `cancelled` is `close-lobby`'s. */
export const tournamentStatusMoves = ['open', 'running', 'completed'] as const;
export type TournamentStatusMove = (typeof tournamentStatusMoves)[number];

const statusRank = (status: TournamentStatus): number =>
  tournamentStatuses.indexOf(status);

/** A tournament moves forward only, through draft, open, running and completed. */
export const isTournamentStatusForward = (
  from: TournamentStatus,
  to: TournamentStatusMove,
): boolean => from !== 'cancelled' && statusRank(to) > statusRank(from);

/** Closing a tournament's lobby cancels it from any status but completed. */
export const isTournamentCancellable = (status: TournamentStatus): boolean =>
  status !== 'completed' && status !== 'cancelled';

// ---------------------------------------------------------------------------
// Shared fields.

const nameSchema = z.string().trim().min(1).max(120);
/** Lower-case letters, digits and inner hyphens; unique ignoring case. */
const lobbyHandleSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/);
const instantSchema = z.iso.datetime();
const versionSchema = z.int().positive();
/** A division key from the event's `entry.divisions` setting. */
const divisionSchema = z.string().trim().min(1).max(64);
const resolutionTextSchema = z.string().trim().min(1).max(300);
/** A JSON object whose contract another slice owns (the season fold's rule). */
const jsonObjectSchema = z.record(z.string().min(1), z.json());

/** The one canonical ballot body; identity and revision belong to the server. */
const ballotDefinitionSettingsSchema = ballotDefinitionBodySchema;

// ---------------------------------------------------------------------------
// Lobby, season, ladder and a standing lobby's Room.

/** Who owns a new lobby: the sender, or an organization (a league). */
const lobbyOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('self') }),
  z.strictObject({ kind: z.literal('organization'), organizationId: idSchema }),
]);

const createLobby = z.strictObject({
  type: z.literal('create-lobby'),
  owner: lobbyOwnerSchema,
  name: nameSchema,
  handle: lobbyHandleSchema,
  /** One command, both kinds: a tournament also gets its schedule extension. */
  lobby: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('standing'),
      ageRule: z.enum(lobbyAgeRules).optional(),
    }),
    z.strictObject({
      kind: z.literal('tournament'),
      eligibility: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('own'),
          ageRule: z.enum(lobbyAgeRules),
        }),
        z.strictObject({ kind: z.literal('standing'), lobbyId: idSchema }),
      ]),
    }),
  ]),
});

const updateLobby = z.strictObject({
  type: z.literal('update-lobby'),
  lobbyId: idSchema,
  name: nameSchema,
  ageRule: z.enum(lobbyAgeRules).optional(),
});

const setTournamentStatus = z.strictObject({
  type: z.literal('set-tournament-status'),
  lobbyId: idSchema,
  status: z.enum(tournamentStatusMoves),
});

const closeLobby = z.strictObject({
  type: z.literal('close-lobby'),
  lobbyId: idSchema,
  reason: z.string().trim().min(1).max(500),
});

const createSeason = z
  .strictObject({
    type: z.literal('create-season'),
    organizationId: idSchema,
    lobbyId: idSchema,
    name: nameSchema,
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    counting: z.enum(seasonCountings),
    countsLobbyRooms: z.boolean(),
    rule: jsonObjectSchema,
  })
  .refine(
    (season) =>
      season.endsAt === null || isInstantBefore(season.startsAt, season.endsAt),
    { message: 'A season ends after it starts.', path: ['endsAt'] },
  );

const standingLobbyAddress = { organizationId: idSchema, lobbyId: idSchema };
const editStandingLobby = z.strictObject({
  type: z.literal('edit-standing-lobby'),
  ...standingLobbyAddress,
  name: nameSchema,
  ageRule: z.enum(lobbyAgeRules),
});
const saveLadder = z.strictObject({
  type: z.literal('save-ladder'),
  ...standingLobbyAddress,
  ladderId: idSchema.nullable(),
  name: nameSchema,
});
const editSeason = z.strictObject({
  type: z.literal('edit-season'),
  ...standingLobbyAddress,
  seasonId: idSchema,
  name: nameSchema,
  endsAt: instantSchema.nullable(),
});

const closeSeason = z.strictObject({
  type: z.literal('close-season'),
  seasonId: idSchema,
});

const setLadder = z.strictObject({
  type: z.literal('set-ladder'),
  organizationId: idSchema,
  lobbyId: idSchema,
  ladder: z.discriminatedUnion('enabled', [
    z.strictObject({ enabled: z.literal(true), name: nameSchema }),
    z.strictObject({ enabled: z.literal(false) }),
  ]),
});

/**
 * The existing Room create, in a standing lobby: a template the lobby
 * offers, or none and the host's own format where `room.own_format` allows.
 */
const createLobbyRoom = z.strictObject({
  type: z.literal('create-lobby-room'),
  lobbyId: idSchema,
  templateId: idSchema.nullable(),
  room: roomCreateSchema,
  /**
   * Exact displayed Room settings, validated against the actual offered pin
   * and chain; required, so a stale form is always refused, never re-applied.
   */
  config: roomConfigSchema,
  /** A named league/lobby pool wording, never inferred from matching custom text. */
  poolResolutionId: idSchema.optional(),
});

const lobbyCommandSchema = z.discriminatedUnion('type', [
  createLobby,
  updateLobby,
  setTournamentStatus,
  closeLobby,
  createSeason,
  closeSeason,
  editSeason,
  editStandingLobby,
  saveLadder,
  setLadder,
  createLobbyRoom,
]);
export type LobbyCommand = z.infer<typeof lobbyCommandSchema>;

// ---------------------------------------------------------------------------
// Tournament setup. Every command names its lobby and checks its version.

export const entryShapeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal(entryKinds[0]) }),
  z.strictObject({
    kind: z.literal(entryKinds[1]),
    size: z.int().min(2).max(8),
  }),
]);

/** An event pins a format and ballot definition, or follows a template's. */
export const eventPinSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('format'),
    formatId: z.string().trim().min(1),
    formatVersion: versionSchema,
    /** Null is the Daisy ballot. */
    ballotDefinition: ballotDefinitionPinSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal('template'), templateId: idSchema }),
]);

const labelSchema = z.string().trim().min(1).max(12).nullable();

const addEvent = z.strictObject({
  type: z.literal('add-event'),
  lobbyId: idSchema,
  name: nameSchema,
  label: labelSchema,
  entry: entryShapeSchema,
  pin: eventPinSchema,
});

const updateEvent = z.strictObject({
  type: z.literal('update-event'),
  lobbyId: idSchema,
  eventId: idSchema,
  name: nameSchema,
  label: labelSchema,
  ballotDefinition: ballotDefinitionPinSchema.nullable(),
});

const removeEvent = z.strictObject({
  type: z.literal('remove-event'),
  lobbyId: idSchema,
  eventId: idSchema,
});

const stageTimingSchema = z.discriminatedUnion('timing', [
  z.strictObject({ timing: z.literal('live') }),
  z
    .strictObject({
      timing: z.literal('windowed'),
      opensAt: instantSchema,
      closesAt: instantSchema,
    })
    .refine((window) => isInstantBefore(window.opensAt, window.closesAt), {
      message: 'A window closes after it opens.',
      path: ['closesAt'],
    }),
]);

const stageFields = {
  lobbyId: idSchema,
  place: z.enum(stagePlaces),
  timing: stageTimingSchema,
  /** Only an elimination stage may be for one division. */
  division: divisionSchema.nullable(),
};

const addStage = z
  .strictObject({
    type: z.literal('add-stage'),
    eventId: idSchema,
    kind: z.enum(stageKinds),
    ...stageFields,
  })
  .refine((stage) => stage.division === null || stage.kind === 'elimination', {
    message: 'Only an elimination stage has a division.',
    path: ['division'],
  });

/** A stage's structure is fixed once added; a different one is a new stage. */
const updateStage = z.strictObject({
  type: z.literal('update-stage'),
  stageId: idSchema,
  ...stageFields,
});

/** The tab round's pool, and its fixed wording where the rule is `fixed`. */
export const tabRoundResolutionSchema = z
  .strictObject({ poolId: idSchema, poolResolutionId: idSchema.nullable() })
  .nullable();

const addTabRound = z.strictObject({
  type: z.literal('add-tab-round'),
  lobbyId: idSchema,
  stageId: idSchema,
  name: nameSchema.nullable(),
  resolution: tabRoundResolutionSchema,
});

const updateTabRound = z.strictObject({
  type: z.literal('update-tab-round'),
  lobbyId: idSchema,
  tabRoundId: idSchema,
  name: nameSchema.nullable(),
  resolution: tabRoundResolutionSchema,
});

const addTimeSlot = z.strictObject({
  type: z.literal('add-time-slot'),
  lobbyId: idSchema,
  name: nameSchema,
  startsAt: instantSchema,
});

const updateTimeSlot = z.strictObject({
  type: z.literal('update-time-slot'),
  lobbyId: idSchema,
  timeSlotId: idSchema,
  name: nameSchema,
  startsAt: instantSchema,
});

const removeTimeSlot = z.strictObject({
  type: z.literal('remove-time-slot'),
  lobbyId: idSchema,
  timeSlotId: idSchema,
});

const placeTabRound = z.strictObject({
  type: z.literal('place-tab-round'),
  lobbyId: idSchema,
  tabRoundId: idSchema,
  /** Null takes the tab round out of its slot. */
  timeSlotId: idSchema.nullable(),
});

/** Always a new version: a new definition, or the next version of one. */
const defineBallot = z.strictObject({
  type: z.literal('define-ballot'),
  lobbyId: idSchema,
  ballotDefinition: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('new'), name: nameSchema }),
    z.strictObject({
      kind: z.literal('revision'),
      ballotDefinitionId: idSchema,
    }),
  ]),
  settings: ballotDefinitionSettingsSchema,
});

const addResolution = z.strictObject({
  type: z.literal('add-resolution'),
  lobbyId: idSchema,
  pool: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('existing'), poolId: idSchema }),
    z.strictObject({ kind: z.literal('new'), name: nameSchema }),
  ]),
  text: resolutionTextSchema,
});

const retireResolution = z.strictObject({
  type: z.literal('retire-resolution'),
  lobbyId: idSchema,
  poolResolutionId: idSchema,
});

const tournamentSetupCommandSchema = z.discriminatedUnion('type', [
  addEvent,
  updateEvent,
  removeEvent,
  addStage,
  updateStage,
  addTabRound,
  updateTabRound,
  addTimeSlot,
  updateTimeSlot,
  removeTimeSlot,
  placeTabRound,
  defineBallot,
  addResolution,
  retireResolution,
]);
export type TournamentSetupCommand = z.infer<
  typeof tournamentSetupCommandSchema
>;

export const lobbySetupCommandSchema = z.discriminatedUnion('type', [
  ...lobbyCommandSchema.options,
  ...tournamentSetupCommandSchema.options,
]);
export type LobbySetupCommand = z.infer<typeof lobbySetupCommandSchema>;

export const lobbySetupCommandEnvelopeSchema = lobbyCommandEnvelope(
  lobbySetupCommandSchema,
);

// ---------------------------------------------------------------------------
// Refusals and the catalogue.

/** Every refusal of this group beside the shared ones, closed. */
export const lobbySetupRefusals = [
  'owner-not-organization',
  'owner-not-league',
  'standing-lobby-required',
  'age-rule-inherited',
  'handle-taken',
  'lobby-not-tournament',
  'lobby-not-standing',
  'status-order',
  'rounds-running',
  'results-incomplete',
  'season-open',
  'season-closed',
  'season-end-before-start',
  'ladder-foreign',
  'ladder-unchanged',
  'ladder-in-use',
  'setting-enforced',
  'template-not-offered',
  'template-required',
  'template-format-mismatch',
  'pool-resolution-required',
  'rating-format-unsupported',
  'format-unavailable',
  'template-unavailable',
  'enforced-conflict',
  'entries-exist',
  'template-pinned',
  'event-sanctioned',
  'stage-started',
  'division-unknown',
  'rounds-placed',
  'draw-published',
  'resolution-released',
  'resolution-not-fixed',
  'resolution-retired',
  'resolution-in-use',
  'slot-in-use',
  'stage-windowed',
  'slot-clash',
  'breaks-share-slot',
  'placement-unchanged',
] as const;
export type LobbySetupRefusal = (typeof lobbySetupRefusals)[number];

const setup = (
  refusals: readonly LobbySetupRefusal[],
  versions: LobbyCommandDefinition['versions'] = ['lobby'],
): LobbyCommandDefinition<LobbySetupRefusal> => ({
  aggregate: 'lobby',
  gate: ['lobby.setup.manage'],
  versions,
  refusals: ['lobby-not-tournament', ...refusals],
  history: 'entry',
});

export const lobbySetupCommandCatalogue = {
  'create-lobby': {
    aggregate: 'lobby',
    gate: ['lobby.create'],
    versions: [],
    refusals: [
      'owner-not-organization',
      'owner-not-league',
      'standing-lobby-required',
      'handle-taken',
    ],
    history: 'entry',
  },
  'update-lobby': {
    aggregate: 'lobby',
    gate: ['lobby.setup.manage'],
    versions: ['lobby'],
    refusals: ['lobby-not-tournament', 'age-rule-inherited', 'entries-exist'],
    history: 'entry',
  },
  'set-tournament-status': {
    aggregate: 'lobby',
    gate: ['lobby.setup.manage'],
    versions: ['lobby'],
    refusals: [
      'lobby-not-tournament',
      'status-order',
      'rounds-running',
      'results-incomplete',
    ],
    history: 'entry',
  },
  'close-lobby': {
    aggregate: 'lobby',
    gate: ['lobby.setup.manage'],
    versions: ['lobby'],
    refusals: ['rounds-running'],
    history: 'entry',
  },
  'create-season': {
    aggregate: 'season',
    gate: ['organization.manage'],
    versions: [],
    refusals: ['owner-not-league', 'lobby-not-standing', 'season-open'],
    history: 'entry',
  },
  'close-season': {
    aggregate: 'season',
    gate: ['organization.manage'],
    versions: ['season'],
    refusals: ['season-closed'],
    history: 'entry',
  },
  'edit-season': {
    aggregate: 'season',
    gate: ['organization.manage'],
    versions: ['season'],
    refusals: [
      'lobby-not-standing',
      'season-closed',
      'season-end-before-start',
    ],
    history: 'entry',
  },
  'edit-standing-lobby': {
    aggregate: 'lobby',
    gate: ['organization.manage'],
    versions: ['lobby'],
    refusals: ['lobby-not-standing'],
    history: 'entry',
  },
  'save-ladder': {
    aggregate: 'lobby',
    gate: ['organization.manage'],
    versions: ['lobby'],
    refusals: ['lobby-not-standing'],
    history: 'entry',
  },
  'set-ladder': {
    aggregate: 'lobby',
    gate: ['organization.manage'],
    versions: ['lobby'],
    refusals: [
      'ladder-foreign',
      'lobby-not-standing',
      'ladder-unchanged',
      'ladder-in-use',
    ],
    history: 'entry',
  },
  'create-lobby-room': {
    aggregate: 'room',
    gate: ['lobby.room.create'],
    versions: [],
    refusals: [
      'lobby-not-standing',
      'setting-enforced',
      'template-not-offered',
      'template-required',
      'template-format-mismatch',
      'pool-resolution-required',
      'rating-format-unsupported',
    ],
    history: 'entry',
  },
  'add-event': setup([
    'format-unavailable',
    'template-unavailable',
    'enforced-conflict',
  ]),
  'update-event': setup(['entries-exist', 'template-pinned']),
  'remove-event': setup(['entries-exist', 'event-sanctioned']),
  'add-stage': setup(['division-unknown']),
  'update-stage': setup(['stage-started', 'division-unknown', 'rounds-placed']),
  'add-tab-round': setup(['resolution-not-fixed', 'resolution-retired']),
  'update-tab-round': setup([
    'draw-published',
    'resolution-released',
    'resolution-not-fixed',
    'resolution-retired',
  ]),
  'add-time-slot': setup([]),
  'update-time-slot': setup(['slot-in-use'], ['lobby', 'timeSlot']),
  'remove-time-slot': setup(['slot-in-use'], ['lobby', 'timeSlot']),
  'place-tab-round': setup(
    [
      'draw-published',
      'stage-windowed',
      'slot-clash',
      'breaks-share-slot',
      'placement-unchanged',
    ],
    ['lobby', 'timeSlot'],
  ),
  'define-ballot': setup([]),
  'add-resolution': setup([]),
  'retire-resolution': setup(['resolution-retired', 'resolution-in-use']),
} as const satisfies LobbyCommandCatalogue<LobbySetupCommand>;
