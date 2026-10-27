import type { Browser } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { createLaunchContexts } from './room-launch-contexts';
import { origin, signUpProvisional } from './accounts';
import { expect } from './fixtures';
import { approveBetaAccounts } from './beta-access';
/**
 * Boundary-length real usernames, claimed through the ordinary onboarding
 * handler, then approved for the beta (ADR 0075).
 */
export function createHumanJudgeProofAccounts(browser: Browser) {
  return createLaunchContexts(
    4,
    () => browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
    async (context) => {
      const { email } = await signUpProvisional(context.request);
      const username = createId().padEnd(32, 'x');
      const response = await context.request.post('/api/account/username', {
        headers: { origin },
        data: { username },
      });
      expect(response.status()).toBe(201);
      await approveBetaAccounts(email);
      return { username };
    },
  );
}
