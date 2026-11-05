import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import { canUseRoundAnalysis } from './authorization';
import { createRoundAnalysisHandlers } from './handlers';
import { roundAnalysisView } from './policy';

/**
 * The completed Round's own debater may read their delivered report after
 * paid access lapses. Read authority remains separate from generation access.
 */
export function composeRoundAnalysisRoutes(app: App) {
  return createRoundAnalysisHandlers({
    ...composeRoundMemberDependencies(app),
    read: async (caller, roundId) => {
      const { access, facts } = await app.database.readRoundAnalysis({
        caller,
        roundId,
        authorize: (access) =>
          canUseRoundAnalysis(
            access,
            app.config.PREMIUM_BETA_GRANT,
            'round.analysis.read',
            app.clock.now(),
          ),
      });
      if (facts.status !== 'completed') throw createAppError('NOT_FOUND');
      const now = app.clock.now();
      return roundAnalysisView({
        facts,
        entitled: canUseRoundAnalysis(
          access,
          app.config.PREMIUM_BETA_GRANT,
          'round.analysis.generate',
          now,
        ),
        now,
        enabled: app.config.ROUND_ANALYSIS_POLICY !== undefined,
      });
    },
  });
}
