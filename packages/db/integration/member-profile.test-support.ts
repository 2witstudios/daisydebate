import { createId } from '@paralleldrive/cuid2';
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
) => {
  const formatId = await fixture.format();
  const roomId = createId();
  await fixture.insert('rooms', {
    id: roomId,
    host_actor_id: await fixture.actor(),
    title: 'Profile proof',
    topic: 'Motion',
    visibility,
    format_id: formatId,
    format_version: 1,
    competition_type: 'casual',
    config: validConfig,
    execution_plan: {
      preRoundPrep: { enabled: false },
      resolutionDraw: { enabled: false },
    },
    rules_snapshot: validRules,
    status: 'started',
  });
  return fixture.round({
    room_id: roomId,
    room_config_snapshot: validConfig,
    visibility,
    format_id: formatId,
    ...overrides,
  });
};

/** A completed casual Round seating `member` on `side` against a new human. */
export const played = async (
  fixture: Fixture,
  input: {
    readonly member: string;
    readonly side: 'affirmative' | 'negative';
    readonly outcome: 'affirmative' | 'negative' | 'draw' | null;
    readonly day: number;
    readonly visibility?: 'public' | 'private';
  },
) => {
  const id = await roomRound(
    fixture,
    {
      status: 'completed',
      outcome: input.outcome,
      started_at: at(input.day, 11),
      completed_at: at(input.day),
    },
    input.visibility,
  );
  await fixture.participant(id, input.side, 0, input.member);
  const other = input.side === 'affirmative' ? 'negative' : 'affirmative';
  const opponent = await fixture.participant(id, other, 0);
  return { id, opponent };
};

export const forfeitCommand = (
  fixture: Fixture,
  roundId: string,
  actorId: string,
) =>
  fixture.insert(
    'round_commands',
    {
      command_id: createId(),
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
  });

/** A profile the test expects to exist. */
export const present = async <T>(read: Promise<T | null>): Promise<T> => {
  const value = await read;
  if (value === null) throw new Error('Expected a member profile');
  return value;
};

export const tally = (
  groups: readonly { role: string; outcome: string | null; rounds: number }[],
) => groups.map((g) => `${g.role}:${g.outcome}:${g.rounds}`).sort();

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
