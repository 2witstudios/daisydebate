import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import {
  lobbyKinds,
  organizationKinds,
  releaseCauses,
  stageKinds,
  stagePlaces,
  tournamentStatuses,
} from './vocabulary';

/**
 * The participant side's lobby reads (TAB-5.14): one lobby contract that
 * serves a standing lobby and a tournament, discriminated on `kind`; the
 * lobbies a viewer may see; and the Rooms of one lobby. Data only: ids,
 * names people typed, statuses, instants and counts. Every list is asked of
 * one lobby or of the viewer, never of a Room collection.
 */

const name = z.string().trim().min(1).max(200);
const instant = z.iso.datetime();
const count = z.int().nonnegative();
const handle = z.string().regex(/^[a-z0-9-]{1,64}$/);

/** A lobby belongs to a league, or to the person who opened it. */
export const lobbyOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('organization'),
    organizationId: idSchema,
    organizationKind: z.enum(organizationKinds),
    name,
  }),
  z.strictObject({
    kind: z.literal('person'),
    actorId: idSchema,
    username: name,
  }),
]);

/**
 * What the viewer is to a lobby, computed from grants, entries, tournament
 * judges, guardian links and memberships. Empty for someone with no part,
 * which a signed-out reader always is.
 */
export const lobbyViewerRoles = [
  'host',
  'member',
  'competitor',
  'judge',
  'responsible_adult',
] as const;
export type LobbyViewerRole = (typeof lobbyViewerRoles)[number];
const viewerRolesSchema = z.array(z.enum(lobbyViewerRoles)).max(5);

/** One tab round as a schedule names it. `name` is the host's, when typed. */
export const tabRoundRefSchema = z.strictObject({
  tabRoundId: idSchema,
  eventId: idSchema,
  number: z.int().positive(),
  name: name.nullable(),
  stage: z.enum(stageKinds),
});
export type TabRoundRef = z.infer<typeof tabRoundRefSchema>;

/** Who may enter, when the tournament says nothing narrower. */
export const entryEligibilities = [
  'anyone',
  'organization_members',
  'organization_added',
] as const;

/** A tournament's entry window and how full it is. */
const entryWindowSchema = z.strictObject({
  /** Null once entry has opened. */
  opensAt: instant.nullable(),
  closesAt: instant,
  /** Null for a tournament with no cap. */
  capacity: z.int().positive().nullable(),
  taken: count,
  eligibility: z.enum(entryEligibilities),
  /** A limit the host typed on what each person may enter. */
  limit: z.string().trim().min(1).max(400).nullable(),
});

/** Who has entered so far: by school, or by person with their rating. */
const enteredSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('schools'),
      schools: z.array(z.strictObject({ name, entries: count })).max(8),
      more: count,
    }),
    z.strictObject({
      kind: z.literal('people'),
      people: z
        .array(z.strictObject({ username: name, rating: z.int() }))
        .max(8),
      more: count,
    }),
  ])
  .nullable();

/** One of the viewer's entries in a tournament, as standings now place it. */
const viewerEntrySchema = z.strictObject({
  entryId: idSchema,
  eventId: idSchema,
  name,
  /** The viewer's teammates, by name. */
  partners: z.array(name).max(8),
  /** Preliminary wins and losses so far; null before any result is released. */
  record: z.strictObject({ wins: count, losses: count }).nullable(),
  /** Where the entry finished, once the event's results are certified. */
  finish: z
    .strictObject({
      place: z.int().positive(),
      of: z.int().positive(),
      /** The elimination round that ended its run, and how it went. */
      out: z
        .strictObject({
          tabRoundName: name,
          to: name,
          judgesFor: count,
          judgesAgainst: count,
        })
        .nullable(),
      seasonPoints: count.nullable(),
    })
    .nullable(),
});

/**
 * Whether a host's stop needs anything. A slot's word is its state; a count
 * is what is waiting on the host.
 */
const hostSlotStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('scheduled') }),
  z.strictObject({ kind: z.literal('drafting') }),
  z.strictObject({ kind: z.literal('drawn') }),
  z.strictObject({ kind: z.literal('needs_host'), count: z.int().positive() }),
  z.strictObject({ kind: z.literal('live') }),
  z.strictObject({ kind: z.literal('done') }),
]);

/** What only a host's view of a tournament carries: what waits on them. */
const tournamentHostSchema = z.strictObject({
  /** Setup steps not yet done. */
  setupUnfinished: count,
  entryCount: count,
  slots: z
    .array(z.strictObject({ timeSlotId: idSchema, state: hostSlotStateSchema }))
    .max(64),
  breakState: z.enum(['scheduled', 'pending', 'ready', 'announced']),
  certified: z.boolean(),
});

/** Whether results of the viewer's audiences are open on this tournament. */
const resultsOpenSchema = z.strictObject({
  standings: z.boolean(),
  /** `not_drawn`: open to the viewer, with no bracket yet. */
  bracket: z.enum(['open', 'not_drawn', 'closed']),
  /** When the viewer's own scores and feedback open. */
  scoresOpenAt: z.enum(releaseCauses).nullable(),
});

const common = {
  lobbyId: idSchema,
  /** The lobby's handle, which its addresses use. */
  handle,
  name,
  owner: lobbyOwnerSchema,
  /** Whether the viewer is signed in; a signed-out reader has no roles. */
  signedIn: z.boolean(),
  viewerRoles: viewerRolesSchema,
  /** The instant the read was answered, for anything shown relative to now. */
  asOf: instant,
};

export const standingLobbyViewSchema = z.strictObject({
  kind: z.literal('standing'),
  ...common,
  /** The resolution pool this month's Rooms strike from. */
  resolutionPool: z
    .strictObject({
      name,
      resolutions: count,
      theme: name,
      /** How many each Room draws to strike from. */
      perRoom: z.int().positive(),
    })
    .nullable(),
  /** The owning league's season this lobby's tournaments count toward. */
  season: name.nullable(),
  offeredTemplates: z
    .array(z.strictObject({ templateId: idSchema, name }))
    .max(32),
  /** The viewer's line on this lobby's ladder; null when they are not on it. */
  ladder: z
    .strictObject({
      rating: z.int(),
      place: z.int().positive(),
      of: z.int().positive(),
    })
    .nullable(),
  capabilities: z.strictObject({ createRoom: z.boolean() }),
});

export const tournamentLobbyViewSchema = z.strictObject({
  kind: z.literal('tournament'),
  ...common,
  status: z.enum(tournamentStatuses),
  startsAt: instant,
  place: z.enum(stagePlaces),
  certifiedAt: instant.nullable(),
  entry: entryWindowSchema,
  entered: enteredSchema,
  /** What the host wrote about how the tournament runs, in order. */
  terms: z
    .array(
      z.strictObject({
        title: name,
        detail: z.string().trim().min(1).max(600),
      }),
    )
    .max(12),
  events: z.array(z.strictObject({ eventId: idSchema, name })).max(32),
  /** In order. A slot names every tab round scheduled in it. */
  timeSlots: z
    .array(
      z.strictObject({
        timeSlotId: idSchema,
        name,
        startsAt: instant,
        tabRounds: z
          .array(
            tabRoundRefSchema.extend({
              /** Whether the round's posting is open to the viewer's audiences. */
              posting: z.boolean(),
            }),
          )
          .max(32),
      }),
    )
    .max(64),
  /** When the break is announced; null for a tournament without one. */
  break: z.strictObject({ at: instant, announced: z.boolean() }).nullable(),
  viewerEntries: z.array(viewerEntrySchema).max(16),
  /** The viewer's wards, for a guardian. */
  wards: z.array(z.strictObject({ actorId: idSchema, name })).max(16),
  /** The school whose entries the viewer answers for, for a coach. */
  school: z.strictObject({ organizationId: idSchema, name }).nullable(),
  results: resultsOpenSchema,
  /** Null for anyone the gate `lobby.host.read` does not allow. */
  host: tournamentHostSchema.nullable(),
  capabilities: z.strictObject({
    enter: z.boolean(),
    manageEntries: z.boolean(),
  }),
});

/** One lobby, as one viewer may see it. */
export const lobbyViewSchema = z.discriminatedUnion('kind', [
  standingLobbyViewSchema,
  tournamentLobbyViewSchema,
]);
export type LobbyView = z.infer<typeof lobbyViewSchema>;
export type StandingLobbyView = z.infer<typeof standingLobbyViewSchema>;
export type TournamentLobbyView = z.infer<typeof tournamentLobbyViewSchema>;

/** The lobby list's query: by kind, and by owning organization. */
export const lobbyListQuerySchema = z.strictObject({
  kind: z.enum(lobbyKinds).nullable(),
  ownerOrganizationId: idSchema.nullable(),
});

/** What the viewer is doing at a listed tournament. */
const listedPartSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('host') }),
    z.strictObject({
      kind: z.literal('competitor'),
      events: z.array(name).min(1).max(16),
    }),
    z.strictObject({
      kind: z.literal('judge'),
      events: z.array(name).min(1).max(16),
    }),
    z.strictObject({ kind: z.literal('school'), school: name }),
    z.strictObject({
      kind: z.literal('guardian'),
      wards: z.array(name).min(1).max(16),
    }),
  ])
  .nullable();

/** Where a running tournament is right now. */
const listedNowSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('round_opens'),
      tabRoundName: name,
      at: instant,
    }),
    z.strictObject({ kind: z.literal('break_at'), at: instant }),
    z.strictObject({ kind: z.literal('live'), tabRoundName: name }),
  ])
  .nullable();

/** One lobby a viewer may see. A lobby open only by link is never listed. */
export const listedLobbySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('standing'),
    lobbyId: idSchema,
    handle,
    name,
    owner: lobbyOwnerSchema,
  }),
  z.strictObject({
    kind: z.literal('tournament'),
    lobbyId: idSchema,
    handle,
    name,
    owner: lobbyOwnerSchema,
    /** A school that hosts it for the owner, when there is one. */
    hostedBy: name.nullable(),
    status: z.enum(tournamentStatuses),
    startsAt: instant,
    /** Its events in order. */
    events: z.array(name).max(32),
    /** Whether its events run at the same time, sharing time slots. */
    concurrentEvents: z.boolean(),
    entry: entryWindowSchema,
    part: listedPartSchema,
    now: listedNowSchema,
    /** Once certified: who won, and where the viewer's own entry finished. */
    finish: z
      .strictObject({
        winner: name,
        viewer: z
          .strictObject({ place: z.int().positive(), of: z.int().positive() })
          .nullable(),
      })
      .nullable(),
  }),
]);
export type ListedLobby = z.infer<typeof listedLobbySchema>;

export const lobbyListPageSchema = z.strictObject({
  asOf: instant,
  lobbies: z.array(listedLobbySchema).max(100),
  /** Listed lobbies past this page. */
  more: count,
  /** Null for a signed-out reader. */
  capabilities: z.strictObject({ createLobby: z.boolean() }).nullable(),
});
export type LobbyListPage = z.infer<typeof lobbyListPageSchema>;

/** The Room list is asked of one lobby (`room.list` on that lobby). */
export const lobbyRoomListQuerySchema = z.strictObject({ lobbyId: idSchema });

/** One Room of a standing lobby, as its list shows it. */
export const listedRoomSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('open'),
    roomId: idSchema,
    name,
    host: z.strictObject({ username: name, rating: z.int().nullable() }),
    school: name.nullable(),
    /** The seats still empty, by kind. */
    open: z.strictObject({ debaters: count, judges: count }),
    openedAt: instant,
    capabilities: z.strictObject({ join: z.boolean(), judge: z.boolean() }),
  }),
  z.strictObject({
    status: z.literal('live'),
    roomId: idSchema,
    debaters: z.array(name).min(1).max(8),
    judges: z.array(name).max(8),
    /** The segment running now, as the format names it. */
    segment: name,
    capabilities: z.strictObject({ watch: z.boolean() }),
  }),
]);
export type ListedRoom = z.infer<typeof listedRoomSchema>;

export const lobbyRoomListSchema = z.strictObject({
  lobbyId: idSchema,
  asOf: instant,
  rooms: z.array(listedRoomSchema).max(100),
});
export type LobbyRoomList = z.infer<typeof lobbyRoomListSchema>;

/** The viewer's ladder page of a standing lobby: the top, or around them. */
export const lobbyLadderQuerySchema = z.strictObject({
  lobbyId: idSchema,
  scope: z.enum(['top', 'around']),
  search: z.string().max(40),
});

const ladderLineSchema = z.strictObject({
  actorId: idSchema,
  place: z.int().positive(),
  username: name,
  school: name.nullable(),
  wins: count,
  losses: count,
  rating: z.int(),
  /** The change over the last rated Room. */
  change: z.int(),
});

export const lobbyLadderSchema = z.strictObject({
  lobbyId: idSchema,
  entrants: count,
  page: z.int().positive(),
  pages: z.int().positive(),
  /** The viewer's own line, which leads the top of the ladder. */
  viewer: ladderLineSchema.nullable(),
  lines: z.array(ladderLineSchema).max(50),
});
export type LobbyLadder = z.infer<typeof lobbyLadderSchema>;

export const lobbyReadCatalogue = {
  LobbyListPage: { gate: 'signed-in' },
  LobbyView: { gate: ['lobby.read'] },
  LobbyRoomList: { gate: ['room.list'] },
  LobbyLadder: { gate: ['lobby.read'] },
} as const satisfies LobbyReadCatalogue<
  'LobbyListPage' | 'LobbyView' | 'LobbyRoomList' | 'LobbyLadder'
>;
