import { type RoundBallotAccess } from '@daisy/protocol/ballot-audience';
import type { RoundRoomAuthority } from '@daisy/db/stores/rounds';
import { authorize } from '@daisy/auth/authorization';
import { eventRoomOwner } from '../tab/event-room-direction';

/** Each part is evaluated on current scoped grants and recorded openings, never Round completion. */
export const eventBallotAccess = (
  caller: { readonly userId: string; readonly actorId: string },
  authority: RoundRoomAuthority,
): RoundBallotAccess => {
  const direction = authority.kind === 'event' ? authority.direction : null;
  const owner = direction
    ? eventRoomOwner(direction, authority.checkedAt)
    : null;
  if (!direction || !owner) return { parts: [], unreleased: false };
  const decisions = (['decision', 'scores', 'reason', 'feedback'] as const).map(
    (part) => ({
      part,
      decision: authorize({
        principal: { kind: 'user', ...caller },
        capability: 'ballot.read',
        context: {
          account: direction.authorization.account,
          grants: direction.authorization.grants,
          now: authority.checkedAt,
        },
        resource: {
          kind: 'ballot',
          scope: owner.scope,
          conflict: owner.conflict,
          viewing: owner.viewing,
          part,
        },
      }),
    }),
  );
  return {
    parts: decisions
      .filter(({ decision }) => decision.allow)
      .map(({ part }) => part),
    unreleased: decisions.some(
      ({ decision }) =>
        decision.allow &&
        (decision.authority.kind === 'owner' ||
          decision.authority.kind === 'grant'),
    ),
  };
};
