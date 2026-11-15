import { and, eq } from 'drizzle-orm';
import { createRefusal } from '@daisy/errors';
import {
  ballotDefinitionSchema,
  freezeBallotJudging,
  type RoundJudging,
  type RoundRules,
} from '@daisy/protocol';
import {
  ballotDefinitions,
  ballotDefinitionVersions,
} from './schema/ballot-definitions';
import { rooms } from './schema/rooms';
import { lobbies } from './schema/lobbies';
import { templates } from './schema/templates';
import type { Tx } from './room-command-facts';

/** Read only the immutable version actually pinned by this authorized, locked Room. */
export const freezeRoomBallot = async (
  tx: Pick<Tx, 'select'>,
  roomId: string,
  rules: RoundRules,
): Promise<RoundJudging> => {
  const unavailable = (): never => {
    throw createRefusal('CONFLICT', 'ballot-definition-unavailable');
  };
  const [room] = await tx
    .select({
      id: rooms.id,
      lobbyId: rooms.lobbyId,
      ballotDefinitionId: rooms.ballotDefinitionId,
      ballotDefinitionVersion: rooms.ballotDefinitionVersion,
      ownerOrganizationId: lobbies.ownerOrganizationId,
      templateOrganizationId: templates.organizationId,
    })
    .from(rooms)
    .innerJoin(lobbies, eq(lobbies.id, rooms.lobbyId))
    .leftJoin(templates, eq(templates.id, rooms.templateId))
    .where(eq(rooms.id, roomId));
  if (!room) return unavailable();
  if (
    room.ballotDefinitionId === null &&
    room.ballotDefinitionVersion === null
  ) {
    const answer = freezeBallotJudging(rules, null);
    return answer.kind === 'frozen' ? answer.judging : unavailable();
  }
  if (room.ballotDefinitionId === null || room.ballotDefinitionVersion === null)
    return unavailable();
  // Version rows and owner identity are immutable; currentVersion is deliberately never read.
  const [version] = await tx
    .select({
      definition: ballotDefinitionVersions.definition,
      organizationId: ballotDefinitions.organizationId,
      lobbyId: ballotDefinitions.lobbyId,
    })
    .from(ballotDefinitionVersions)
    .innerJoin(
      ballotDefinitions,
      eq(ballotDefinitions.id, ballotDefinitionVersions.ballotDefinitionId),
    )
    .where(
      and(
        eq(
          ballotDefinitionVersions.ballotDefinitionId,
          room.ballotDefinitionId,
        ),
        eq(ballotDefinitionVersions.version, room.ballotDefinitionVersion),
      ),
    );
  if (
    !version ||
    !(
      version.lobbyId === room.lobbyId ||
      (version.organizationId !== null &&
        (version.organizationId === room.ownerOrganizationId ||
          version.organizationId === room.templateOrganizationId))
    )
  )
    return unavailable();
  const definition = ballotDefinitionSchema.safeParse(version.definition);
  if (!definition.success) return unavailable();
  const answer = freezeBallotJudging(rules, {
    source: {
      kind: 'stored',
      id: room.ballotDefinitionId,
      version: room.ballotDefinitionVersion,
    },
    ballot: definition.data,
  });
  return answer.kind === 'frozen' ? answer.judging : unavailable();
};
