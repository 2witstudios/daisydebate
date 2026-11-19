import { hydrateRoundRows } from '../round-hydration';
import type { FixtureCommandContext } from './fixture-command-context';
import type { Tx } from '../tx';

/** The real current Round is the undelayed read's target; a fixture identifier cannot stand in for one. */
export const readFixtureWaiverRound = async (
  tx: Tx,
  context: FixtureCommandContext,
) => {
  if (!context.round || !context.room) return null;
  const round = await hydrateRoundRows(tx, context.round.id);
  if (!round) return null;
  return {
    kind: 'round' as const,
    roundId: round.id,
    createdByActorId: context.round.createdByActorId,
    visibility: context.room.visibility,
    status: round.status,
    revision: round.version,
    participants: round.participants.flatMap((person) =>
      person.actorId ? [{ actorId: person.actorId, seat: person.seat }] : [],
    ),
  };
};
