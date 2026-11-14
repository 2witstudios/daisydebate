import type { SharedLobbyRefusal } from '@daisy/protocol/lobby/command';
import type {
  EntryCommand,
  EntryRefusal,
} from '@daisy/protocol/lobby/entry-command';
import type { entryStatuses, responsibleKinds } from '@daisy/protocol/lobby';
import type { FixtureChange } from '@daisy/protocol/lobby/command';
import { isRepairable, type LiveFixtureState } from './draw';
import { refuse, type CommandDecision } from './run-command';

type EntryStatus = (typeof entryStatuses)[number];
type ResponsibleKind = (typeof responsibleKinds)[number];

/**
 * A minor's boundary as the entry commands read it: the parent's
 * restriction (`restrictions`, with `limits_lobbies` set) and the lobbies it
 * allows (`restriction_lobbies`). `version` is the boundary's revision.
 */
export type BoundaryFacts = {
  readonly guardianLinkId: string;
  readonly guardianUserId: string;
  readonly allowedLobbyIds: readonly string[];
  readonly version: number;
};

/** A person a command enters, keeps or brings into an entry. */
export type EntryPersonFacts = {
  readonly actorId: string;
  readonly userId: string | null;
  readonly minor: boolean;
  /** Within the event's `entry.age_band`, from the account's age facts. */
  readonly withinAgeBand: boolean;
  /** The event's divisions this person may enter. */
  readonly divisions: readonly string[];
  /** In another entry of this event that is not withdrawn. */
  readonly enteredInEvent: boolean;
  /** In an accepted entry of another event that shares a time slot with this one. */
  readonly enteredInSharedSlot: boolean;
  /** The boundary a parent set, when it limits lobbies; null when none. */
  readonly boundary: BoundaryFacts | null;
};

/** A published fixture of the entry, with its Room and its slot guard. */
export type EntryLiveFixtureFacts = {
  readonly fixtureId: string;
  readonly tabRoundId: string;
  readonly roomId: string | null;
  readonly timeSlot: { readonly id: string; readonly version: number } | null;
  readonly state: LiveFixtureState;
  /** Entry members and judges seated in it, as accounts. */
  readonly people: readonly string[];
};

/** An `entries` row with its members and what the commands read about it. */
export type EntryRowFacts = {
  readonly id: string;
  readonly status: EntryStatus;
  readonly division: string | null;
  readonly responsibleKind: ResponsibleKind;
  /** The guardian of the entry's guardian link, when it is a guardian's entry. */
  readonly guardianUserId: string | null;
  readonly version: number;
  readonly members: readonly EntryPersonFacts[];
  readonly liveFixtures: readonly EntryLiveFixtureFacts[];
  /** The elimination stages it qualified for, under `break.double_qualifier`. */
  readonly breakChoice: {
    readonly open: boolean;
    readonly qualified: readonly {
      readonly stageId: string;
      readonly division: string;
    }[];
  };
};

/**
 * What an entry command is decided from: the event row and its resolved
 * entry settings, the sender, the people the command names and the entry it
 * names. Time and fresh ids come in here, never from a clock.
 */
export type EntryFacts = {
  readonly commandId: string;
  readonly now: string;
  /** The id a submitted entry takes. */
  readonly newEntryId: string;
  readonly event: {
    readonly id: string;
    readonly lobbyId: string;
    readonly entriesVersion: number;
    /** `entry.divisions`. */
    readonly divisions: readonly string[];
    /** `entry.approval`. */
    readonly approval: 'automatic' | 'host';
    /** `entry.cap`; null is none. */
    readonly entryCap: number | null;
    /** Entries not withdrawn. */
    readonly entryCount: number;
    readonly registration: {
      readonly opensAt: string | null;
      readonly closesAt: string | null;
    };
    /** A stage of the event has a published draw. */
    readonly started: boolean;
  };
  readonly sender: {
    readonly userId: string | null;
    /** Holds `tournament.entries.manage` in the lobby. */
    readonly host: boolean;
  };
  /** The people a command names but who are not in the entry yet. */
  readonly people: readonly EntryPersonFacts[];
  /** The responsible adult `submit-entry` names, as stored. */
  readonly responsible:
    | {
        readonly kind: 'school';
        readonly schoolOrganizationId: string;
        readonly found: boolean;
      }
    | {
        readonly kind: 'guardian';
        readonly guardianLinkId: string;
        readonly guardianUserId: string;
        readonly minorUserId: string;
        readonly active: boolean;
      }
    | { readonly kind: 'self' }
    | null;
  readonly entry: EntryRowFacts | null;
};

type EntryRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly eventId: string;
  readonly name: string;
  readonly status: EntryStatus;
  readonly division: string | null;
  readonly responsibleKind: ResponsibleKind;
  readonly schoolOrganizationId: string | null;
  readonly guardianLinkId: string | null;
};
type EntryMemberRow = {
  readonly entryId: string;
  readonly actorId: string;
  readonly eventId: string;
  readonly lobbyId: string;
  readonly entryStatus: EntryStatus;
};

/** The rows an entry command writes, on the merged tables' columns. */
export type EntryWrite =
  | { readonly table: 'entries'; readonly op: 'insert'; readonly row: EntryRow }
  | {
      readonly table: 'entries';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: Partial<
        Pick<EntryRow, 'status' | 'division'> & {
          readonly breakDivision: string;
        }
      >;
    }
  | {
      readonly table: 'entry_members';
      readonly op: 'insert';
      readonly row: EntryMemberRow;
    }
  | {
      readonly table: 'entry_members';
      readonly op: 'delete';
      readonly where: { readonly entryId: string; readonly actorId: string };
    }
  | {
      readonly table: 'events';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: { readonly entriesVersion: number };
    }
  | {
      readonly table: 'restrictions';
      readonly op: 'update';
      readonly where: { readonly guardianLinkId: string };
      readonly set: { readonly version: number };
    }
  | {
      readonly table: 'room_participants';
      readonly op: 'update';
      readonly where: { readonly roomId: string; readonly actorId: string };
      readonly set: { readonly actorId: string };
    }
  | {
      readonly table: 'time_slots';
      readonly op: 'update';
      readonly where: { readonly id: string; readonly version: number };
      readonly set: { readonly version: number };
    };

export type EntryDecision = CommandDecision<
  EntryRefusal | SharedLobbyRefusal,
  EntryWrite
>;

/**
 * Whether a guardian is awaited for this person: their parent limits the
 * lobbies they may enter, this lobby is not among them, and the entry is
 * not the guardian's own. Such an entry stays pending (TAB-5.23).
 */
export const guardianAwaited = (
  person: EntryPersonFacts,
  lobbyId: string,
  madeByUserId: string | null,
): boolean =>
  person.boundary !== null &&
  !person.boundary.allowedLobbyIds.includes(lobbyId) &&
  person.boundary.guardianUserId !== madeByUserId;

const before = (a: string, b: string) => Date.parse(a) < Date.parse(b);

const registrationOpen = (facts: EntryFacts): boolean => {
  const { opensAt, closesAt } = facts.event.registration;
  return (
    (opensAt === null || !before(facts.now, opensAt)) &&
    (closesAt === null || before(facts.now, closesAt))
  );
};

const hasResponsibleAdult = (
  facts: EntryFacts,
  command: Extract<EntryCommand, { type: 'submit-entry' }>,
  members: readonly EntryPersonFacts[],
): boolean => {
  const responsible = facts.responsible;
  if (responsible === null || responsible.kind !== command.responsible.kind)
    return false;
  switch (responsible.kind) {
    case 'school':
      return responsible.found;
    case 'guardian':
      return (
        responsible.active &&
        members.some((member) => member.userId === responsible.minorUserId)
      );
    case 'self':
      return (
        members.length === 1 &&
        !members[0]!.minor &&
        members[0]!.userId === facts.sender.userId
      );
  }
};

/** The event's entries changed: its version moves with every entry command. */
const accepted = (
  facts: EntryFacts,
  writes: readonly EntryWrite[],
  fixtureChanges: readonly FixtureChange[] = [],
): EntryDecision => {
  const entriesVersion = facts.event.entriesVersion + 1;
  return {
    kind: 'accepted',
    aggregate: { kind: 'event', id: facts.event.id },
    resultingVersion: entriesVersion,
    writes: [
      ...writes,
      {
        table: 'events',
        op: 'update',
        where: { id: facts.event.id },
        set: { entriesVersion },
      },
    ],
    findings: [],
    fixtureChanges,
  };
};

/** Accepting an entry for an account with a boundary bumps the boundary's revision. */
const boundaryRevisions = (
  members: readonly EntryPersonFacts[],
): EntryWrite[] =>
  members.flatMap((member) =>
    member.boundary === null
      ? []
      : [
          {
            table: 'restrictions',
            op: 'update',
            where: { guardianLinkId: member.boundary.guardianLinkId },
            set: { version: member.boundary.version + 1 },
          } as const,
        ],
  );

const submitEntry = (
  facts: EntryFacts,
  command: Extract<EntryCommand, { type: 'submit-entry' }>,
): EntryDecision => {
  if (command.eventId !== facts.event.id) return refuse('not-found');
  const members = command.memberActorIds.map((actorId) =>
    facts.people.find((person) => person.actorId === actorId),
  );
  if (members.some((member) => member === undefined))
    return refuse('not-found');
  const people = members as readonly EntryPersonFacts[];
  if (!registrationOpen(facts)) return refuse('registration-closed');
  if (people.some((person) => person.enteredInEvent))
    return refuse('already-entered');
  if (people.some((person) => !person.withinAgeBand)) return refuse('age-band');
  if (!hasResponsibleAdult(facts, command, people))
    return refuse('no-responsible-adult');
  const division = command.division;
  if (division !== null && !facts.event.divisions.includes(division))
    return refuse('division-unknown');
  if (
    division !== null &&
    people.some((person) => !person.divisions.includes(division))
  )
    return refuse('division-ineligible');
  if (
    facts.event.entryCap !== null &&
    facts.event.entryCount >= facts.event.entryCap
  )
    return refuse('entry-cap');
  if (people.some((person) => person.enteredInSharedSlot))
    return refuse('slot-clash');
  const awaited = people.some((person) =>
    guardianAwaited(person, facts.event.lobbyId, facts.sender.userId),
  );
  const status: EntryStatus =
    !awaited && (facts.sender.host || facts.event.approval === 'automatic')
      ? 'accepted'
      : 'pending';
  const entryId = facts.newEntryId;
  return accepted(facts, [
    {
      table: 'entries',
      op: 'insert',
      row: {
        id: entryId,
        lobbyId: facts.event.lobbyId,
        eventId: facts.event.id,
        name: command.name,
        status,
        division,
        responsibleKind: command.responsible.kind,
        schoolOrganizationId:
          command.responsible.kind === 'school'
            ? command.responsible.schoolOrganizationId
            : null,
        guardianLinkId:
          command.responsible.kind === 'guardian'
            ? command.responsible.guardianLinkId
            : null,
      },
    },
    ...people.map(
      (person) =>
        ({
          table: 'entry_members',
          op: 'insert',
          row: {
            entryId,
            actorId: person.actorId,
            eventId: facts.event.id,
            lobbyId: facts.event.lobbyId,
            entryStatus: status,
          },
        }) as const,
    ),
    ...(status === 'accepted' ? boundaryRevisions(people) : []),
  ]);
};

const setStatus = (entryId: string, status: EntryStatus): EntryWrite => ({
  table: 'entries',
  op: 'update',
  where: { id: entryId },
  set: { status },
});

const acceptEntry = (
  facts: EntryFacts,
  entry: EntryRowFacts,
): EntryDecision => {
  if (entry.status !== 'pending') return refuse('entry-settled');
  if (entry.members.some((member) => member.enteredInSharedSlot))
    return refuse('slot-clash');
  const madeBy =
    entry.responsibleKind === 'guardian' ? entry.guardianUserId : null;
  if (
    entry.members.some((member) =>
      guardianAwaited(member, facts.event.lobbyId, madeBy),
    )
  )
    return refuse('guardian-pending');
  return accepted(facts, [
    setStatus(entry.id, 'accepted'),
    ...boundaryRevisions(entry.members),
  ]);
};

const replaceEntryMember = (
  facts: EntryFacts,
  entry: EntryRowFacts,
  command: Extract<EntryCommand, { type: 'replace-entry-member' }>,
): EntryDecision => {
  const incoming = facts.people.find(
    (person) => person.actorId === command.inActorId,
  );
  if (
    incoming === undefined ||
    !entry.members.some((member) => member.actorId === command.outActorId)
  )
    return refuse('not-found');
  if (entry.liveFixtures.some((fixture) => !isRepairable(fixture.state)))
    return refuse('fixture-started');
  if (incoming.enteredInEvent) return refuse('already-entered');
  if (incoming.enteredInSharedSlot) return refuse('slot-clash');
  if (entry.division !== null && !incoming.divisions.includes(entry.division))
    return refuse('division-ineligible');
  const slots = new Map(
    entry.liveFixtures.flatMap((fixture) =>
      fixture.timeSlot === null
        ? []
        : [[fixture.timeSlot.id, fixture.timeSlot.version] as const],
    ),
  );
  return accepted(
    facts,
    [
      {
        table: 'entry_members',
        op: 'delete',
        where: { entryId: entry.id, actorId: command.outActorId },
      },
      {
        table: 'entry_members',
        op: 'insert',
        row: {
          entryId: entry.id,
          actorId: command.inActorId,
          eventId: facts.event.id,
          lobbyId: facts.event.lobbyId,
          entryStatus: entry.status,
        },
      },
      ...entry.liveFixtures.flatMap((fixture) =>
        fixture.roomId === null
          ? []
          : [
              {
                table: 'room_participants',
                op: 'update',
                where: { roomId: fixture.roomId, actorId: command.outActorId },
                set: { actorId: command.inActorId },
              } as const,
            ],
      ),
      ...[...slots].map(
        ([id, version]) =>
          ({
            table: 'time_slots',
            op: 'update',
            where: { id, version },
            set: { version: version + 1 },
          }) as const,
      ),
    ],
    entry.liveFixtures.map((fixture) => ({
      kind: 'officiated',
      fixtureId: fixture.fixtureId,
      tabRoundId: fixture.tabRoundId,
      commandId: facts.commandId,
      type: command.type,
      people: [...new Set([...fixture.people, command.inActorId])]
        .filter((person) => person !== command.outActorId)
        .sort(),
    })),
  );
};

const setEntryDivision = (
  facts: EntryFacts,
  entry: EntryRowFacts,
  division: string | null,
): EntryDecision => {
  if (division !== null && !facts.event.divisions.includes(division))
    return refuse('division-unknown');
  if (
    division !== null &&
    entry.members.some((member) => !member.divisions.includes(division))
  )
    return refuse('division-ineligible');
  if (facts.event.started) return refuse('stage-started');
  return accepted(facts, [
    {
      table: 'entries',
      op: 'update',
      where: { id: entry.id },
      set: { division },
    },
  ]);
};

const chooseBreak = (
  facts: EntryFacts,
  entry: EntryRowFacts,
  stageId: string,
): EntryDecision => {
  const { qualified, open } = entry.breakChoice;
  const chosen = qualified.find((stage) => stage.stageId === stageId);
  if (qualified.length < 2 || chosen === undefined)
    return refuse('not-double-qualified');
  if (!open) return refuse('choice-closed');
  return accepted(facts, [
    {
      table: 'entries',
      op: 'update',
      where: { id: entry.id },
      set: { breakDivision: chosen.division },
    },
  ]);
};

/**
 * Decides one entry command from its facts: every rule that spans rows,
 * each with its named refusal. Authority is the runner's gate; an entry is
 * its responsible adult's, which the evaluator reads from the entry.
 */
export const decideEntry = (
  facts: EntryFacts,
  command: EntryCommand,
): EntryDecision => {
  if (command.type === 'submit-entry') return submitEntry(facts, command);
  const entry = facts.entry;
  if (entry === null || entry.id !== command.entryId)
    return refuse('not-found');
  switch (command.type) {
    case 'accept-entry':
      return acceptEntry(facts, entry);
    case 'decline-entry':
      return entry.status === 'pending'
        ? accepted(facts, [setStatus(entry.id, 'withdrawn')])
        : refuse('entry-settled');
    case 'withdraw-entry':
      // The reason is kept in the command's action-history entry.
      return entry.status === 'withdrawn'
        ? refuse('entry-settled')
        : accepted(facts, [setStatus(entry.id, 'withdrawn')]);
    case 'replace-entry-member':
      return replaceEntryMember(facts, entry, command);
    case 'set-entry-division':
      return setEntryDivision(facts, entry, command.division);
    case 'choose-break':
      return chooseBreak(facts, entry, command.stageId);
  }
};
