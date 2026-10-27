import { createAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { composeRoundMemberDependencies } from '../round-runtime/member-composition';
import { canReadRoundAnalysis } from './authorization';
import { createRoundAnalysisHandlers } from './handlers';
import { roundAnalysisView } from './policy';

/**
 * The round analysis read: the only place its premium gate meets a reader.
 * A seated debater of a completed Round gets their own view, `locked`
 * without the entitlement; anyone else, a Round still running included,
 * gets NOT_FOUND.
 */
export function composeRoundAnalysisRoutes(app: App) {
  return createRoundAnalysisHandlers({
    ...composeRoundMemberDependencies(app),
    read: async (caller, roundId) => {
      const { access, facts } = await app.database.readRoundAnalysis({
        caller,
        roundId,
      });
      if (facts.status !== 'completed') throw createAppError('NOT_FOUND');
      return roundAnalysisView({
        facts,
        entitled: canReadRoundAnalysis(access, app.config.PREMIUM_BETA_GRANT),
        now: app.clock.now(),
        enabled: app.config.ROUND_ANALYSIS_POLICY !== undefined,
      });
    },
  });
}
