import { z } from 'zod';
import { idSchema } from '../primitives';
import type { LobbyReadCatalogue } from './read';
import { administrativeResultReasons, drawStatuses } from './vocabulary';

/**
 * The host's reads of a running tab round and of a time slot across every
 * event in it (TAB-5.13): each fixture with where it stands and whether it
 * waits on the host, and in a slot, what needs attention.
 */

const name = z.string().trim().min(1).max(200);
/** Words a person or a check wrote; a projection shows them as they are. */
const text = z.string().trim().min(1).max(2000);
const count = z.int().min(0);
const position = z.int().min(1);
const durationMs = z.int().min(0);
const instant = z.iso.datetime();

/** A tab round's fixtures are pairings or sections; byes ride beside either. */
export const roomedFixtureKinds = ['pairing', 'section'] as const;

const entryRef = z.strictObject({ entryId: idSchema, name });
const judgeRef = z.strictObject({ tournamentJudgeId: idSchema, name });
const roomRef = z.strictObject({ roomId: idSchema, name });

/** A result as the host sees it: every part, whatever has been released. */
const fixtureResult = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('decided'),
    /** Whether a correction superseded the first result. */
    corrected: z.boolean(),
    entries: z
      .array(
        z.strictObject({
          entryId: idSchema,
          won: z.boolean().nullable(),
          rank: position.nullable(),
          points: z.number().min(0).nullable(),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    kind: z.literal('administrative'),
    corrected: z.boolean(),
    reason: z.enum(administrativeResultReasons),
  }),
]);

/** Where one fixture stands, as far as the host's attention goes. */
const fixtureState = z.discriminatedUnion('kind', [
  /** A judge has not opened the ballot that is due. */
  z.strictObject({
    kind: z.literal('ballot_overdue'),
    judge: judgeRef,
    overdueByMs: durationMs,
    speechesGiven: count,
  }),
  /** A command on this fixture waits for a second person. */
  z.strictObject({
    kind: z.literal('confirmation_requested'),
    pendingCommandId: idSchema,
    /** The proposer's request and why it waits, as the pending command records it. */
    summary: text,
    canConfirm: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('speaking'),
    segment: position,
    segmentCount: position,
    /** Who has the floor, where the format names one speaker at a time. */
    speaker: name.nullable(),
  }),
  z.strictObject({
    kind: z.literal('judging'),
    ballotsIn: count,
    ballotsDue: position,
    openForMs: durationMs,
  }),
  z.strictObject({ kind: z.literal('finished'), result: fixtureResult }),
]);

const tabRoundFixture = z.strictObject({
  fixtureId: idSchema,
  kind: z.enum(['pairing', 'section', 'bye']),
  /** A section's letter; pairings and byes are named by their entries. */
  label: name.nullable(),
  entries: z.array(entryRef).min(1),
  room: roomRef.nullable(),
  judges: z.array(judgeRef),
  /** Whether the viewer is in conflict on this fixture. */
  conflict: z.boolean(),
  state: fixtureState,
});
export type TabRoundFixture = z.infer<typeof tabRoundFixture>;

export const tabRoundHostViewSchema = z.strictObject({
  lobbyId: idSchema,
  eventId: idSchema,
  tabRound: z.strictObject({
    tabRoundId: idSchema,
    number: position,
    name: name.nullable(),
  }),
  fixtureKind: z.enum(roomedFixtureKinds),
  fixtureCount: count,
  entryCount: count,
  /** The resolved `pairing.section_size` target, for an event drawn in sections. */
  sectionSize: position.nullable(),
  /** What a bye counts as: the resolved `bye.result`. */
  byeCountsAs: z.enum(['win', 'own_average']),
  startedAt: instant,
  progress: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('running'), behindByMs: durationMs }),
    z.strictObject({ kind: z.literal('complete') }),
  ]),
  /** Whether participants have a posting for this tab round. */
  postedToParticipants: z.boolean(),
  /** The event's next tab round, while its draft draw waits to be published. */
  next: z
    .strictObject({ tabRoundId: idSchema, number: position, name: name.nullable() })
    .nullable(),
  /** Every fixture that is not finished, in the order the tab keeps them. */
  open: z.array(tabRoundFixture),
  /** The finished fixtures, most recent first: their count and the first few. */
  finished: z.strictObject({ total: count, recent: z.array(tabRoundFixture) }),
  capabilities: z.strictObject({ officiate: z.boolean() }),
});
export type TabRoundHostView = z.infer<typeof tabRoundHostViewSchema>;

/** How an event's fixtures in the slot stand, by count. */
const fixtureCounts = z.strictObject({
  waitingForJudge: count,
  preparing: count,
  live: count,
  judging: count,
  ballotsIn: count,
});

const slotEvent = z.strictObject({
  eventId: idSchema,
  name,
  formatName: name,
  fixtureKind: z.enum(roomedFixtureKinds),
  /** Division labels whose entries share the pool but break on their own line. */
  separateBreaks: z.array(name),
  tabRound: z.strictObject({
    tabRoundId: idSchema,
    number: position,
    drawStatus: z.enum(drawStatuses),
  }),
  roomCount: count,
  fixtures: fixtureCounts,
  /** For a tab round with a released resolution: when, and when speeches begin. */
  resolution: z
    .strictObject({ releasedAt: instant, speechesBeginAt: instant })
    .nullable(),
});

/** One thing in the slot that waits on the host. */
const slotConcern = z.discriminatedUnion('kind', [
  /** A judge seated here is still busy in a fixture of an earlier slot. */
  z.strictObject({
    kind: z.literal('judge_held_elsewhere'),
    eventId: idSchema,
    fixtureId: idSchema,
    entries: z.array(entryRef).min(1),
    judge: judgeRef,
    elsewhere: z.strictObject({
      eventName: name,
      fixtureKind: z.enum(roomedFixtureKinds),
      fixtureLabel: name,
      timeSlotStartsAt: instant,
    }),
  }),
  /** A judge seated here withdrew; a free, clear judge may be offered. */
  z.strictObject({
    kind: z.literal('judge_withdrawn'),
    eventId: idSchema,
    fixtureId: idSchema,
    room: roomRef,
    judge: judgeRef,
    replacement: judgeRef.nullable(),
  }),
  /** A tab round's draft draw has every result it needs. */
  z.strictObject({
    kind: z.literal('draw_ready'),
    eventId: idSchema,
    tabRoundId: idSchema,
    tabRoundNumber: position,
    ballotsIn: count,
    /** When the other events in the slot publish, if it may wait for them. */
    publishWithOthersAt: instant.nullable(),
  }),
]);

export const timeSlotHostViewSchema = z.strictObject({
  lobbyId: idSchema,
  timeSlot: z.strictObject({ timeSlotId: idSchema, name, startsAt: instant }),
  behindByMs: durationMs.nullable(),
  events: z.array(slotEvent).min(1),
  concerns: z.array(slotConcern),
  /** The slot after this one, with what is ready for it. */
  next: z
    .strictObject({
      timeSlotId: idSchema,
      name,
      startsAt: instant,
      drawnEvents: z.array(
        z.strictObject({
          eventId: idSchema,
          name,
          fixtureKind: z.enum(roomedFixtureKinds),
        }),
      ),
      fixtureCount: count,
      /** Its judges who are seated in this slot, and how many of those run late. */
      judgesSeatedHere: count,
      judgesRunningLate: count,
    })
    .nullable(),
  capabilities: z.strictObject({
    officiate: z.boolean(),
    editDraw: z.boolean(),
  }),
});
export type TimeSlotHostView = z.infer<typeof timeSlotHostViewSchema>;
export type TimeSlotConcern = z.infer<typeof slotConcern>;

export const tabRoundReadCatalogue = {
  TabRoundHostView: { gate: ['lobby.host.read'] },
  TimeSlotHostView: { gate: ['lobby.host.read'] },
} as const satisfies LobbyReadCatalogue<'TabRoundHostView' | 'TimeSlotHostView'>;
