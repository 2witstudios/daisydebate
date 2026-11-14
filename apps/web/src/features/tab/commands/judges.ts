import type { AuthorizationInput } from '@daisy/auth/authorization';
import type {
  judgeStrikeSources,
  tournamentJudgeStatuses,
} from '@daisy/protocol/lobby';
import type { SharedLobbyRefusal } from '@daisy/protocol/lobby/command';
import type {
  JudgeCommand,
  JudgeRefusal,
} from '@daisy/protocol/lobby/entry-command';
import { refuse, type CommandDecision } from './run-command';

type TournamentJudgeStatus = (typeof tournamentJudgeStatuses)[number];
type JudgeStrikeSource = (typeof judgeStrikeSources)[number];

/** A `tournament_judges` row with what the judge commands read about it. */
export type TournamentJudgeFacts = {
  readonly id: string;
  readonly actorId: string;
  readonly status: TournamentJudgeStatus;
  readonly version: number;
  /** Its `judge_availability` rows. */
  readonly availability: readonly {
    readonly timeSlotId: string;
    readonly available: boolean;
  }[];
  /** The published fixtures it sits on, with their slot and entries. */
  readonly liveFixtures: readonly {
    readonly fixtureId: string;
    readonly timeSlotId: string | null;
    readonly entryIds: readonly string[];
  }[];
};

/**
 * What a judge command is decided from. A strike or a conflict also reads
 * the entry it names and its event's entries version.
 */
export type JudgeFacts = {
  readonly lobbyId: string;
  /** The id an invited judge takes. */
  readonly newJudgeId: string;
  readonly sender: { readonly actorId: string };
  readonly eventIds: readonly string[];
  readonly timeSlotIds: readonly string[];
  /** The judge the command names; for `invite-judge`, any row for that actor. */
  readonly judge: TournamentJudgeFacts | null;
  readonly entry: {
    readonly id: string;
    readonly eventId: string;
    readonly entriesVersion: number;
    /** Its `judge_strikes` rows. */
    readonly strikes: readonly {
      readonly tournamentJudgeId: string;
      readonly source: JudgeStrikeSource;
    }[];
  } | null;
};

type TournamentJudgeRow = {
  readonly id: string;
  readonly lobbyId: string;
  readonly actorId: string;
  readonly schoolOrganizationId: string | null;
  readonly status: TournamentJudgeStatus;
  readonly chairQualified: boolean;
};
type JudgeStrikeRow = {
  readonly entryId: string;
  readonly tournamentJudgeId: string;
  readonly eventId: string;
  readonly lobbyId: string;
  readonly source: JudgeStrikeSource;
};

/** The rows a judge command writes, on the merged tables' columns. */
export type JudgeWrite =
  | {
      readonly table: 'tournament_judges';
      readonly op: 'insert';
      readonly row: TournamentJudgeRow;
    }
  | {
      readonly table: 'tournament_judges';
      readonly op: 'update';
      readonly where: { readonly id: string; readonly version: number };
      readonly set: Partial<
        Pick<
          TournamentJudgeRow,
          'status' | 'schoolOrganizationId' | 'chairQualified'
        >
      > & { readonly version: number };
    }
  | {
      readonly table: 'judge_events';
      readonly op: 'insert';
      readonly row: {
        readonly tournamentJudgeId: string;
        readonly eventId: string;
        readonly lobbyId: string;
      };
    }
  | {
      readonly table: 'judge_events';
      readonly op: 'delete';
      readonly where: { readonly tournamentJudgeId: string };
    }
  | {
      readonly table: 'judge_availability';
      readonly op: 'insert';
      readonly row: {
        readonly tournamentJudgeId: string;
        readonly timeSlotId: string;
        readonly lobbyId: string;
        readonly available: boolean;
      };
    }
  | {
      readonly table: 'judge_availability';
      readonly op: 'update';
      readonly where: {
        readonly tournamentJudgeId: string;
        readonly timeSlotId: string;
      };
      readonly set: { readonly available: boolean };
    }
  | {
      readonly table: 'judge_strikes';
      readonly op: 'insert';
      readonly row: JudgeStrikeRow;
    }
  | {
      readonly table: 'judge_strikes';
      readonly op: 'delete';
      readonly where: {
        readonly entryId: string;
        readonly tournamentJudgeId: string;
      };
    }
  | {
      readonly table: 'events';
      readonly op: 'update';
      readonly where: { readonly id: string };
      readonly set: { readonly entriesVersion: number };
    };

export type JudgeDecision = CommandDecision<
  JudgeRefusal | SharedLobbyRefusal,
  JudgeWrite
>;

/**
 * What the authorization input of a judge command must add to its context.
 * `judge.invitation.respond` is both answers: the evaluator lets a decline
 * through a minor's boundary as a way out and bounds anything else as an
 * accept, so the port's `authority(facts)` for `accept-judge-invitation`
 * and `decline-judge-invitation` must spread this into `context` (as
 * `context.answer`). Every other judge command adds nothing.
 */
export const judgeAuthorityContext = (
  command: JudgeCommand,
): Pick<AuthorizationInput['context'], 'answer'> => {
  switch (command.type) {
    case 'accept-judge-invitation':
      return { answer: 'accept' };
    case 'decline-judge-invitation':
      return { answer: 'decline' };
    case 'invite-judge':
    case 'remove-judge':
    case 'strike-judge':
    case 'withdraw-strike':
    case 'set-judge-availability':
    case 'declare-conflict':
      return {};
  }
};

/**
 * The resource each judge command is authorized on. A strike is the
 * entry's own and is made by its responsible adult: its gate
 * (`entry.submit`) is decided on the entry, never on the judge.
 */
export const judgeAuthorityTarget = (
  command: JudgeCommand,
):
  | { readonly kind: 'entry'; readonly entryId: string }
  | { readonly kind: 'judge'; readonly tournamentJudgeId: string }
  | { readonly kind: 'lobby' } => {
  switch (command.type) {
    case 'strike-judge':
    case 'withdraw-strike':
      return { kind: 'entry', entryId: command.entryId };
    case 'accept-judge-invitation':
    case 'decline-judge-invitation':
    case 'set-judge-availability':
    case 'declare-conflict':
      return { kind: 'judge', tournamentJudgeId: command.tournamentJudgeId };
    case 'invite-judge':
    case 'remove-judge':
      return { kind: 'lobby' };
  }
};

const onJudge = (
  facts: JudgeFacts,
  version: number,
  writes: readonly JudgeWrite[],
): JudgeDecision => ({
  kind: 'accepted',
  aggregate: { kind: 'lobby', id: facts.lobbyId },
  resultingVersion: version,
  writes,
  findings: [],
  fixtureChanges: [],
});

const onEntries = (
  entry: NonNullable<JudgeFacts['entry']>,
  writes: readonly JudgeWrite[],
): JudgeDecision => ({
  kind: 'accepted',
  aggregate: { kind: 'event', id: entry.eventId },
  resultingVersion: entry.entriesVersion + 1,
  writes: [
    ...writes,
    {
      table: 'events',
      op: 'update',
      where: { id: entry.eventId },
      set: { entriesVersion: entry.entriesVersion + 1 },
    },
  ],
  findings: [],
  fixtureChanges: [],
});

const setJudge = (
  judge: TournamentJudgeFacts,
  set: Partial<
    Pick<
      TournamentJudgeRow,
      'status' | 'schoolOrganizationId' | 'chairQualified'
    >
  >,
): JudgeWrite => ({
  table: 'tournament_judges',
  op: 'update',
  where: { id: judge.id, version: judge.version },
  set: { ...set, version: judge.version + 1 },
});

const inviteJudge = (
  facts: JudgeFacts,
  command: Extract<JudgeCommand, { type: 'invite-judge' }>,
): JudgeDecision => {
  if (command.eventIds?.some((id) => !facts.eventIds.includes(id)))
    return refuse('not-found');
  const existing = facts.judge;
  if (existing !== null && existing.actorId !== command.actorId)
    return refuse('not-found');
  if (
    existing !== null &&
    (existing.status === 'invited' || existing.status === 'accepted')
  )
    return refuse('already-invited');
  const judgeId = existing?.id ?? facts.newJudgeId;
  const events = (command.eventIds ?? []).map(
    (eventId) =>
      ({
        table: 'judge_events',
        op: 'insert',
        row: { tournamentJudgeId: judgeId, eventId, lobbyId: facts.lobbyId },
      }) as const,
  );
  return existing === null
    ? onJudge(facts, 1, [
        {
          table: 'tournament_judges',
          op: 'insert',
          row: {
            id: judgeId,
            lobbyId: facts.lobbyId,
            actorId: command.actorId,
            schoolOrganizationId: command.schoolOrganizationId,
            status: 'invited',
            chairQualified: command.chairQualified,
          },
        },
        ...events,
      ])
    : onJudge(facts, existing.version + 1, [
        setJudge(existing, {
          status: 'invited',
          schoolOrganizationId: command.schoolOrganizationId,
          chairQualified: command.chairQualified,
        }),
        {
          table: 'judge_events',
          op: 'delete',
          where: { tournamentJudgeId: judgeId },
        },
        ...events,
      ]);
};

const setAvailability = (
  facts: JudgeFacts,
  judge: TournamentJudgeFacts,
  command: Extract<JudgeCommand, { type: 'set-judge-availability' }>,
): JudgeDecision => {
  if (
    command.availability.some(
      (slot) => !facts.timeSlotIds.includes(slot.timeSlotId),
    )
  )
    return refuse('not-found');
  const seatedIn = new Set(
    judge.liveFixtures.map((fixture) => fixture.timeSlotId),
  );
  if (
    command.availability.some(
      (slot) => !slot.available && seatedIn.has(slot.timeSlotId),
    )
  )
    return refuse('judge-assigned');
  return onJudge(facts, judge.version + 1, [
    ...command.availability.map((slot): JudgeWrite =>
      judge.availability.some((row) => row.timeSlotId === slot.timeSlotId)
        ? {
            table: 'judge_availability',
            op: 'update',
            where: { tournamentJudgeId: judge.id, timeSlotId: slot.timeSlotId },
            set: { available: slot.available },
          }
        : {
            table: 'judge_availability',
            op: 'insert',
            row: {
              tournamentJudgeId: judge.id,
              timeSlotId: slot.timeSlotId,
              lobbyId: facts.lobbyId,
              available: slot.available,
            },
          },
    ),
    setJudge(judge, {}),
  ]);
};

const strikeRow = (
  facts: JudgeFacts,
  entry: NonNullable<JudgeFacts['entry']>,
  judge: TournamentJudgeFacts,
  source: JudgeStrikeSource,
): JudgeWrite => ({
  table: 'judge_strikes',
  op: 'insert',
  row: {
    entryId: entry.id,
    tournamentJudgeId: judge.id,
    eventId: entry.eventId,
    lobbyId: facts.lobbyId,
    source,
  },
});

const onEntry = (
  facts: JudgeFacts,
  judge: TournamentJudgeFacts,
  command: Extract<
    JudgeCommand,
    { type: 'strike-judge' | 'withdraw-strike' | 'declare-conflict' }
  >,
): JudgeDecision => {
  const entry = facts.entry;
  if (entry === null || entry.id !== command.entryId)
    return refuse('not-found');
  const strike = entry.strikes.find(
    (row) => row.tournamentJudgeId === judge.id,
  );
  switch (command.type) {
    case 'strike-judge':
      if (strike !== undefined) return refuse('strike-exists');
      if (
        judge.liveFixtures.some((fixture) =>
          fixture.entryIds.includes(entry.id),
        )
      )
        return refuse('judge-assigned');
      return onEntries(entry, [strikeRow(facts, entry, judge, 'entry')]);
    case 'withdraw-strike':
      // A declared conflict is not the entry's strike and is not withdrawn here.
      if (strike?.source !== 'entry') return refuse('strike-absent');
      return onEntries(entry, [
        {
          table: 'judge_strikes',
          op: 'delete',
          where: { entryId: entry.id, tournamentJudgeId: judge.id },
        },
      ]);
    case 'declare-conflict':
      if (strike !== undefined) return refuse('strike-exists');
      return onEntries(entry, [
        strikeRow(
          facts,
          entry,
          judge,
          facts.sender.actorId === judge.actorId ? 'judge' : 'tab',
        ),
      ]);
  }
};

/**
 * Decides one judge command from its facts. Availability is per judge and
 * time slot; an entry's strike is recorded with source `entry` and a
 * declared conflict with `judge` or `tab`, whoever declared it.
 */
export const decideJudge = (
  facts: JudgeFacts,
  command: JudgeCommand,
): JudgeDecision => {
  if (command.type === 'invite-judge') return inviteJudge(facts, command);
  const judge = facts.judge;
  if (judge === null || judge.id !== command.tournamentJudgeId)
    return refuse('not-found');
  switch (command.type) {
    case 'remove-judge':
      if (judge.status === 'removed') return refuse('not-found');
      if (judge.liveFixtures.length > 0) return refuse('judge-assigned');
      return onJudge(facts, judge.version + 1, [
        setJudge(judge, { status: 'removed' }),
      ]);
    case 'accept-judge-invitation':
    case 'decline-judge-invitation':
      if (judge.status !== 'invited') return refuse('invitation-closed');
      return onJudge(facts, judge.version + 1, [
        setJudge(judge, {
          status:
            command.type === 'accept-judge-invitation'
              ? 'accepted'
              : 'declined',
        }),
      ]);
    case 'set-judge-availability':
      return setAvailability(facts, judge, command);
    case 'strike-judge':
    case 'withdraw-strike':
    case 'declare-conflict':
      return onEntry(facts, judge, command);
  }
};
