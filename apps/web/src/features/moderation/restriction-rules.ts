import type { RestrictionRules } from '@daisy/db';
import {
  activeRoomMembers,
  createRoundRuntime,
  forfeitInOpening,
  releaseRestrictedMember,
} from '@daisy/debate-engine';
import { isAppError } from '@daisy/errors';

/**
 * The engine's rules a suspension or ban applies (DEC-331). A Round whose
 * debate is over refuses the forfeit: it waits for its ballot, with nothing
 * left to forfeit, so the refusal means leave it alone.
 */
export const restrictionRules: RestrictionRules = {
  releaseMember: releaseRestrictedMember,
  activeRoomMembers,
  forfeitRound: ({ round, actorId, now, nextSegmentId }) => {
    const hydrated = {
      round,
      rules: round.rules,
      participants: round.participants,
      checkpoint: round.checkpoint,
      segments: round.segments,
      nextSegmentId,
    };
    try {
      return round.opening
        ? forfeitInOpening({
            ...hydrated,
            opening: round.opening.state,
            seed: round.opening.seed,
            now,
            actorId,
          })
        : createRoundRuntime(hydrated).execute({
            command: { type: 'forfeit' },
            actorId,
            now,
          });
    } catch (error) {
      if (isAppError(error) && error.code === 'CONFLICT') return null;
      throw error;
    }
  },
};
