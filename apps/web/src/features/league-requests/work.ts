import { featureWork } from '../../server/feature-work';
import type { ProcessWork } from '../../server/process-work';
import { startLeagueRequestMail } from './mail-worker';

/** League request email; nothing without an owner address. */
export const startLeagueRequestWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    leagueRequestMail: startLeagueRequestMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });
