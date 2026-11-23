import { featureWork, type ProcessWork } from '../../server/feature-work';
import { startLeagueRequestMail } from '../../server/league-request-mail';

/** League request email; nothing without an owner address. */
export const startLeagueRequestWork = ({ app, waits }: ProcessWork) =>
  featureWork({
    leagueRequestMail: startLeagueRequestMail({
      app,
      waits,
      reporter: app.reporter,
    }),
  });
