import { createId } from '@paralleldrive/cuid2';
import type { Fixture } from './constraint-helpers';
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
    execution_plan: { preRoundPrep: { enabled: false }, resolutionDraw: { enabled: false } },
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
