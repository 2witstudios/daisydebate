import type { RestrictionRules } from '@daisy/db';
import {
  activeRoomMembers,
  forfeitOfRestriction,
  releaseRestrictedMember,
} from '@daisy/debate-engine';

/** The engine's rules a suspension or ban applies (DEC-331). */
export const restrictionRules: RestrictionRules = {
  releaseMember: releaseRestrictedMember,
  activeRoomMembers,
  forfeitRound: ({ round, actorId, now, nextSegmentId }) =>
    forfeitOfRestriction({
      round,
      rules: round.rules,
      participants: round.participants,
      checkpoint: round.checkpoint,
      segments: round.segments,
      nextSegmentId,
      opening: round.opening,
      actorId,
      now,
    }),
};
