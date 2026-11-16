import { judgedRound } from './judged-round.test-support';
import { createId } from '@paralleldrive/cuid2';
import { publicLobbyId } from '../src/daisy-reference';
import { validConfig } from './round-fixtures';
import { Fixture } from './constraint-helpers';

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
  const host = await fixture.actor();
  const roomId = await fixture.room(host, 'one-on-one', { format_version: 2 });
  const { roundId, judge } = await fixture.sql.begin(async (tx) => {
    const constructing = new Fixture(tx);
    try {
      const roundId = await judgedRound(constructing, {
        room_id: roomId,
        room_config_snapshot: validConfig,
        visibility: 'public',
      });
      const judge = await constructing.seat(roundId, 'judge');
      return { roundId, judge };
    } finally {
      for (const [table, ids] of constructing.tracked)
        for (const id of ids) fixture.track(table, id);
    }
  });
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
