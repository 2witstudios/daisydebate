import { leagueRequestRetentionTarget } from './retention';
import { featureWork } from '../../server/feature-work';
import type { ProcessFeature, ProcessWork } from '../../server/process-work';
import { startLeagueRequestMail } from './mail-worker';

/** League request email; nothing without an owner address. */
const startLeagueRequestWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    leagueRequestMail: startLeagueRequestMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });

/** This feature in the web process: its background work and its retention targets. */
export const leagueRequestsInProcess: ProcessFeature = {
  work: startLeagueRequestWork,
  retention: ({ app }) => [leagueRequestRetentionTarget(app.database)],
};
