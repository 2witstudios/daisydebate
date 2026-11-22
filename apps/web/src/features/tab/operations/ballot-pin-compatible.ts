import type { SettingGraph } from '@daisy/db/tab';
import {
  ballotDefinitionSchema,
  freezeBallotJudging,
} from '@daisy/protocol/ballot-definition';

/** Check the exact immutable content under the permitted pin owner's scope. */
export const ballotPinCompatible = (
  graph: SettingGraph,
  input: {
    readonly formatId: string;
    readonly formatVersion: number;
    readonly ballotDefinitionId: string | null;
    readonly ballotDefinitionVersion: number | null;
    readonly organizationId: string | null;
    readonly lobbyId: string | null;
  },
): boolean => {
  const format = graph.formats.find(
    (row) =>
      row.formatId === input.formatId && row.version === input.formatVersion,
  );
  if (!format) return false;
  if (
    input.ballotDefinitionId === null &&
    input.ballotDefinitionVersion === null
  )
    return freezeBallotJudging(format.definition, null).kind === 'frozen';
  if (
    input.ballotDefinitionId === null ||
    input.ballotDefinitionVersion === null
  )
    return false;
  const version = graph.ballots.find(
    (row) =>
      row.ballotDefinitionId === input.ballotDefinitionId &&
      row.version === input.ballotDefinitionVersion,
  );
  if (
    !version ||
    !(
      (version.organizationId !== null &&
        version.organizationId === input.organizationId) ||
      (version.lobbyId !== null && version.lobbyId === input.lobbyId)
    )
  )
    return false;
  const ballot = ballotDefinitionSchema.safeParse(version.definition);
  return (
    ballot.success &&
    freezeBallotJudging(format.definition, {
      source: {
        kind: 'stored',
        id: input.ballotDefinitionId,
        version: input.ballotDefinitionVersion,
      },
      ballot: ballot.data,
    }).kind === 'frozen'
  );
};
