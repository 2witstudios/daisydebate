import { createId } from '@paralleldrive/cuid2';
import { publicLobbyId } from '../src/daisy-reference';
import { validConfig } from './round-fixtures';
import type { Fixture } from './constraint-helpers';

class AllowedWrite extends Error {}
export const runtimeRefusal = async (
  fixture: Fixture,
  statement: string,
  id: string,
): Promise<string | null> => {
  try {
    await fixture.sql.begin(async (tx) => {
      await tx`set local role daisy_web`;
      await tx`select set_config('daisy.lobby_scope', ${publicLobbyId}, true)`;
      const rows = await tx.unsafe(statement, [id]);
      if (rows.length !== 1)
        throw new Error('Ballot mutation did not reach its fixture');
      await tx`set constraints all immediate`;
      throw new AllowedWrite();
    });
    return null;
  } catch (error) {
    if (error instanceof AllowedWrite) return null;
    const code = (error as { errno?: unknown }).errno;
    if (typeof code !== 'string') throw error;
    return code;
  }
};
export const frozenBallot = async (fixture: Fixture) => {
  const formatId = await fixture.format();
  const host = await fixture.actor();
  const roomId = await fixture.room(host, formatId);
  const roundId = await fixture.round({
    room_id: roomId,
    format_id: formatId,
    room_config_snapshot: validConfig,
    visibility: 'public',
  });
  const judge = await fixture.seat(roundId, 'judge');
  await fixture.freeze(roundId);
  const ballotId = createId();
  await fixture.insert('ballots', {
    id: ballotId,
    judge_participant_id: judge.id,
    round_id: roundId,
    freeze_revision: 1,
    rubric_version: 'speaker-10@2',
    winner: 'affirmative',
    scores: {},
    reason: 'The submitted reason.',
    feedback: {},
    citations: {},
    submitted_at: new Date(1000),
  });
  return { roundId, ballotId, judge };
};
