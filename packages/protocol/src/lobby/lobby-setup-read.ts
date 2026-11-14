import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import {
  entryKinds,
  sanctionStatuses,
  stageKinds,
  stagePlaces,
  stageTimings,
  tournamentStatuses,
} from './vocabulary';

const name = z.string().trim().min(1).max(200);
const handle = z.string().trim().min(1).max(64);
const count = z.int().min(0);
const version = z.int().min(1);
const instant = z.iso.datetime();

const organizationRef = z.strictObject({ organizationId: idSchema, name });
const formatPin = z.strictObject({
  formatId: idSchema,
  formatVersion: version,
  name,
});
const ballotDefinitionPin = z.strictObject({
  ballotDefinitionId: idSchema,
  ballotDefinitionVersion: version,
  name,
});

export const setupStageSchema = z.strictObject({
  stageId: idSchema,
  kind: z.enum(stageKinds),
  sequence: z.int().min(1),
  /** The division an elimination stage breaks, or null for everyone. */
  division: z.string().min(1).nullable(),
  place: z.enum(stagePlaces),
  timing: z.enum(stageTimings),
});

export const setupTabRoundSchema = z.strictObject({
  tabRoundId: idSchema,
  stageId: idSchema,
  number: z.int().min(1),
  name: name.nullable(),
  timeSlotId: idSchema.nullable(),
  resolutionPoolId: idSchema.nullable(),
});

/** An event as its tournament's setup shows it. */
export const setupEventSchema = z
  .strictObject({
    eventId: idSchema,
    name,
    /** The short name a schedule shows. */
    label: z.string().trim().min(1).max(16).nullable(),
    entryKind: z.enum(entryKinds),
    format: formatPin,
    /** Null is the Daisy ballot. */
    ballotDefinition: ballotDefinitionPin.nullable(),
    /** The template the event follows, with the organization that owns it. */
    template: z
      .strictObject({ templateId: idSchema, name, organization: organizationRef })
      .nullable(),
    stages: z.array(setupStageSchema),
    tabRounds: z.array(setupTabRoundSchema),
    sanction: z
      .strictObject({
        organization: organizationRef,
        status: z.enum(sanctionStatuses),
        requestedAt: instant,
      })
      .nullable(),
  })
  .refine(
    (event) => {
      const stages = new Set(event.stages.map((stage) => stage.stageId));
      return event.tabRounds.every((round) => stages.has(round.stageId));
    },
    { message: 'A tab round belongs to one of its event\'s stages.', path: ['tabRounds'] },
  );
export type SetupEvent = z.infer<typeof setupEventSchema>;

export const setupTimeSlotSchema = z.strictObject({
  timeSlotId: idSchema,
  name,
  startsAt: instant,
});

/** A resolution pool's size; its text is never in setup. */
export const setupResolutionPoolSchema = z.strictObject({
  resolutionPoolId: idSchema,
  name,
  size: count,
});

const common = {
  lobbyId: idSchema,
  handle,
  name,
  /** The organization that owns the lobby, or null when a person does. */
  owner: organizationRef.nullable(),
};

/**
 * A lobby's setup, one contract discriminated on kind. A standing lobby: the
 * templates it offers, its seasons and ladder. A tournament: its events
 * with their template link, stages, tab rounds, time slots and resolution
 * pools. Resolution text is never part of setup, so no variant redacts it.
 */
export const lobbySetupViewSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('standing'),
    ...common,
    templates: z.array(
      z.strictObject({
        templateId: idSchema,
        name,
        format: z.strictObject({ formatId: idSchema, name }),
      }),
    ),
    seasons: z.array(z.strictObject({ seasonId: idSchema, name })),
    ladder: z.strictObject({ ladderId: idSchema, name }).nullable(),
    capabilities: z.strictObject({
      manage: z.boolean(),
      createRoom: z.boolean(),
    }),
  }),
  z
    .strictObject({
      kind: z.literal('tournament'),
      ...common,
      status: z.enum(tournamentStatuses),
      events: z.array(setupEventSchema).min(1),
      timeSlots: z.array(setupTimeSlotSchema),
      resolutionPools: z.array(setupResolutionPoolSchema),
      capabilities: z.strictObject({ manage: z.boolean() }),
    })
    .refine(
      (setup) => {
        const slots = new Set(setup.timeSlots.map((slot) => slot.timeSlotId));
        return setup.events.every((event) =>
          event.tabRounds.every(
            (round) => round.timeSlotId === null || slots.has(round.timeSlotId),
          ),
        );
      },
      { message: 'A tab round runs in one of the tournament\'s time slots.', path: ['events'] },
    ),
]);
export type LobbySetupView = z.infer<typeof lobbySetupViewSchema>;
export type TournamentSetupView = Extract<
  LobbySetupView,
  { kind: 'tournament' }
>;
export type StandingSetupView = Extract<LobbySetupView, { kind: 'standing' }>;

export const lobbySetupReadCatalogue = {
  LobbySetupView: { gate: ['lobby.host.read'] },
} as const satisfies LobbyReadCatalogue<'LobbySetupView'>;
