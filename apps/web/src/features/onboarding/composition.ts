import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import { identify } from '../auth/identity';
import { defineComposition } from '../../server/composition';
import { createOnboardingHandler } from './save-answers';

/** onboarding: the questionnaire's route binds here (`processRoute`). */
export const onboardingComposition = defineComposition('onboarding', (app) => ({
  POST: createOnboardingHandler({
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
    clock: app.clock,
    save: (input) =>
      app.database.saveOnboardingStep({
        ...input,
        admits: admitsOptionalAnswers,
      }),
    complete: (userId, at) => app.database.completeOnboarding(userId, at),
  }),
}));
