import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';
import { createId } from '@paralleldrive/cuid2';
import { sideOfSeat, type SeatRef } from '@daisy/protocol/seats';
import { type RoundOutcome } from '@daisy/protocol/round-outcome';
import { requireTestServices } from '@daisy/config';
import { createDatabase, type Database } from '../src';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';
import { validConfig, validRules } from './round-fixtures';
import { at } from './standings-fixtures';

/** Fixtures for the member profile reads suite (ISSUE-600). */

/** A Round frozen from a started Room, as every played Round is. */
export const roomRound = async (
  fixture: Fixture,
  overrides: Record<string, unknown>,
  visibility: 'public' | 'private' = 'public',
  cast: Parameters<Fixture['roundWithCast']>[1] = [],
) => {
  const judged = cast.some((person) => person.seat === 'judge');
  const compiled = judged
    ? resolveRoomConfiguration(oneOnOneDefinition, oneOnOneSettings)
    : null;
  if (compiled && !compiled.ok)
    throw new Error('Original judged profile source did not compile');
  const rules = compiled?.ok ? compiled.rules : validRules;
  const config = judged ? oneOnOneSettings : validConfig;
  const formatId = judged ? 'one-on-one' : await fixture.format();
  const formatVersion = judged ? 2 : 1;
  const roomId = createId();
  await fixture.insert('rooms', {
    id: roomId,
    host_actor_id: await fixture.actor(),
    title: 'Profile proof',
    topic: 'Motion',
    visibility,
    format_id: formatId,
    format_version: formatVersion,
    competition_type: 'casual',
    config,
    execution_plan: {
      preRoundPrep: { enabled: false },
      resolutionDraw: { enabled: false },
    },
    rules_snapshot: rules,
    status: 'started',
  });
  return (
    await fixture.roundWithCast(
      {
        room_id: roomId,
        room_config_snapshot: config,
        visibility,
        ...overrides,
        format_id: formatId,
        format_version: formatVersion,
      },
      cast,
      { rules },
    )
  ).id;
};

/** A completed casual Round seating `member` on `side` against a new human. */
export const played = async (
  fixture: Fixture,
  input: {
    readonly member: string;
    readonly side: 'affirmative' | 'negative';
    readonly outcome: 'affirmative' | 'negative' | null;
    readonly day: number;
    readonly visibility?: 'public' | 'private';
    readonly judgeActorId?: string;
  },
) => {
  const other = input.side === 'affirmative' ? 'negative' : 'affirmative';
  const id = await roomRound(
    fixture,
    {
      status: 'completed',
      winning_side: input.outcome,
      started_at: at(input.day, 11),
      completed_at: at(input.day),
    },
    input.visibility,
    [
      { seat: input.side, actorId: input.member },
      { seat: other },
      ...(input.judgeActorId
        ? [{ seat: 'judge', actorId: input.judgeActorId }]
        : []),
    ],
  );
  const [row] =
    await fixture.sql`select actor_id from round_participants where round_id=${id} and seat_kind='side' and side=${other}`;
  if (!row) throw new Error('Original opponent identity missing');
  const opponent = String(row.actor_id);
  return { id, opponent };
};

/** A forfeit as the writer commits it: the command and its finalization record. */
export const forfeitCommand = async (
  fixture: Fixture,
  roundId: string,
  actorId: string,
) => {
  const commandId = createId();
  await fixture.insert(
    'round_commands',
    {
      command_id: commandId,
      round_id: roundId,
      actor_id: actorId,
      type: 'forfeit',
      payload_digest: 'a'.repeat(64),
      result: {},
      resulting_version: 2,
      applied_at: at(9),
    },
    'command_id',
  );
  await fixture.insert(
    'round_finalizations',
    { round_id: roundId, command_id: commandId, resulting_version: 2 },
    'round_id',
  );
};

const { databaseUrl: url } = requireTestServices(process.env);

/** The owner's scope only for the bound, current member themself. */
const ownerOnly = (
  memberActorId: string,
  account: {
    readonly actorId: string | null;
    readonly member: boolean;
    readonly erased: boolean;
  } | null,
) =>
  account !== null &&
  account.member &&
  !account.erased &&
  account.actorId === memberActorId
    ? ('owner' as const)
    : ('public' as const);

export const profileOf = (
  database: Database,
  input: {
    readonly username: string;
    readonly caller: {
      readonly userId: string;
      readonly actorId: string;
    } | null;
    readonly before?: string | null;
    readonly limit?: number;
  },
) =>
  database.readMemberProfile({
    username: input.username,
    caller: input.caller,
    decide: ownerOnly,
    before: input.before ?? null,
    limit: input.limit ?? 10,
    clock: { now: new Date().toISOString(), rankedDelaySeconds: 0 },
  });

/** A profile the test expects to exist. */
export const present = async <T>(read: Promise<T | null>): Promise<T> => {
  const value = await read;
  if (value === null) throw new Error('Expected a member profile');
  return value;
};

/** A seat as the suites name it: its side, or its kind for an unsided seat. */
export const seatName = (seat: SeatRef) => sideOfSeat(seat) ?? seat.kind;
/** The winning side an outcome names, or null. */
export const winnerOf = (outcome: RoundOutcome | null) =>
  outcome?.kind === 'winner' ? outcome.side : null;

export const tally = (
  groups: readonly {
    seat: SeatRef;
    outcome: RoundOutcome | null;
    rounds: number;
  }[],
) =>
  groups
    .map((g) => `${seatName(g.seat)}:${winnerOf(g.outcome)}:${g.rounds}`)
    .sort();

/** A fixture, a database over it and one live member, closed after `run`. */
export const withProfileFixture = (
  run: (context: {
    readonly fixture: Fixture;
    readonly database: Database;
    readonly subject: { readonly userId: string; readonly actorId: string };
  }) => Promise<void>,
) =>
  withFixture(url, async (fixture) => {
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await run({
        fixture,
        database,
        subject: await createAuthorizationSubject(fixture),
      });
    } finally {
      await database.close();
    }
  });
