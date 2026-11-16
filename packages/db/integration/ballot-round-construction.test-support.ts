import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { catalogFormats } from '../src/catalog-formats';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';
import { Fixture } from './constraint-helpers';
import { createBotSeat } from './bot-seat.test-support';

/** Real declared Room/grammar and original judge assignments, committed in their one construction transaction. */
export async function constructBallotRound(
  parent: Fixture,
  input: {
    readonly panel?: boolean;
    readonly judgeActorId?: string;
    readonly botJudges?: boolean;
    readonly tournamentLobbyId?: string;
    readonly inTransaction?: boolean;
  } = {},
) {
  const panel = catalogFormats.find((row) => row.id === 'panel-debate');
  if (!panel) throw new Error('The published panel grammar is missing');
  const definition = input.panel ? panel.definition : oneOnOneDefinition;
  const settings = input.panel ? panel.preset : oneOnOneSettings;
  const compiled = resolveRoomConfiguration(definition, settings);
  if (!compiled.ok)
    throw new Error('The original judged grammar did not compile');
  const config = { ...settings, resolutionDraw: { enabled: false } };
  const roomId = await parent.room(
    await parent.actor(),
    input.panel ? panel.id : 'one-on-one',
    {
      format_version: input.panel ? 1 : 2,
      config,
      rules_snapshot: compiled.rules,
      execution_plan: compiled.roomPlan,
      ...(input.tournamentLobbyId
        ? {
            lobby_id: input.tournamentLobbyId,
            lobby_kind: 'tournament',
            host_actor_id: null,
            capture: { broadcast: null, recordingPolicy: 'off' },
          }
        : {}),
    },
  );
  const construct = async (tx: Fixture['sql']) => {
    const constructing = new Fixture(tx);
    try {
      const roundId = await constructing.round(
        {
          room_id: roomId,
          room_config_snapshot: config,
          visibility: 'public',
          format_id: input.panel ? panel.id : 'one-on-one',
          format_version: input.panel ? 1 : 2,
        },
        { rules: compiled.rules },
      );
      const judges = [];
      for (let slot = 0; slot < definition.seats.judges; slot++)
        judges.push(
          input.botJudges
            ? await createBotSeat(constructing, roundId, 'judge', slot)
            : await constructing.seat(
                roundId,
                'judge',
                slot,
                input.judgeActorId,
              ),
        );
      return { roundId, judges };
    } finally {
      for (const [table, ids] of constructing.tracked)
        for (const id of ids) parent.track(table, id);
    }
  };
  return input.inTransaction
    ? construct(parent.sql)
    : parent.sql.begin(construct);
}
