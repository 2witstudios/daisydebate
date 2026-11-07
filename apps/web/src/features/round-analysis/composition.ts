import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import { canUseRoundAnalysis } from './authorization';
import { createRoundAnalysisHandlers } from './handlers';
import { roundAnalysisView } from './policy';

/**
 * The completed Round's own debater may read their delivered report after
 * paid access lapses. Fresh requests separately pass atomic allowance admission.
 */
export function composeRoundAnalysisRoutes(app: App) {
  return createRoundAnalysisHandlers({
    ...composeRoundMemberDependencies(app),
    request: async (caller, roundId) =>
      app.database.requestRoundAnalysis({
        caller,
        roundId,
        authorize: (access) =>
          canUseRoundAnalysis(access, 'round.analysis.request'),
      }),
    read: async (caller, roundId) => {
      const { facts, allowance } = await app.database.readRoundAnalysis({
        caller,
        roundId,
        authorize: (access) =>
          canUseRoundAnalysis(access, 'round.analysis.read'),
      });
      if (facts.status !== 'completed') throw createAppError('NOT_FOUND');
      const now = app.clock.now();
      return roundAnalysisView({
        facts,
        allowance,
        now,
        enabled: app.config.ROUND_ANALYSIS_POLICY !== undefined,
      });
    },
  });
}
