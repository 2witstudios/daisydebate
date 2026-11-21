import { sha3Hex } from '@daisy/digest';
import { createId } from '@paralleldrive/cuid2';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';
import type { Fixture } from './constraint-helpers';

/** An actual published judged revision, compiled unchanged; the unjudged foundation cannot carry a judge. */
export function judgedRound(
  fixture: Fixture,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  const compiled = resolveRoomConfiguration(
    oneOnOneDefinition,
    oneOnOneSettings,
  );
  if (!compiled.ok)
    throw new Error('The original judged revision did not compile');
  return fixture.round(
    { format_id: 'one-on-one', format_version: 2, ...overrides },
    { rules: compiled.rules },
  );
}

/** A separately authored fixture grammar with exactly its tested panel size. */
export async function authoredJudgedRound(fixture: Fixture, judges: number) {
  const definition = {
    ...oneOnOneDefinition,
    seats: { ...oneOnOneDefinition.seats, judges },
  };
  const compiled = resolveRoomConfiguration(definition, oneOnOneSettings);
  if (!compiled.ok) throw new Error('Authored panel fixture did not compile');
  const formatId = await fixture.format(definition);
  return fixture.round(
    { format_id: formatId, format_version: 1 },
    { rules: compiled.rules },
  );
}

/**
 * Replaces the Round's judge in slot 0 the way Tab's change_judge commits it
 * (a new judge identity, the assignment's next version), leaving the first
 * judge's row as retired history.
 */
export const replaceJudge = (f: Fixture, roundId: string, byActorId: string) =>
  f.sql.begin(async (tx) => {
    const replacementActorId = await f.actor();
    const replacementId = createId();
    const commandId = createId();
    await tx`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${replacementId},${roundId},${replacementActorId},'judge',null,0)`;
    const result = {
      kind: 'judge_assignment',
      roundId,
      slot: 0,
      assignmentVersion: 2,
      participantId: replacementId,
    };
    const digest = sha3Hex(JSON.stringify(result));
    await tx`insert into round_commands(command_id,round_id,actor_id,service_id,type,payload_digest,result,resulting_version,applied_at) values(${commandId},${roundId},${byActorId},null,'change_judge',${digest},${result},2,date_trunc('milliseconds',clock_timestamp()))`;
    await tx`select public.daisy_append_round_judge_assignment(${roundId},0,1,1,${replacementId},${commandId})`;
    return replacementActorId;
  });
