import { createAccountFlows } from './auth-account-helpers';
import { elapse } from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/** The global per-minute sign-up ceiling's bucket. */
export const GLOBAL_MINUTE = 'auth:magic-link:global:60';

/**
 * The global sign-up ceiling suites' harness: real accounts, a magic-link
 * request from its own client (or a given one), the minute window elapsing,
 * and the work a saturated request finishes after its answer.
 */
export function createCeilingFlows() {
  const accounts = createAccountFlows();
  const { flows } = accounts;
  const { testApp, newClient } = flows;
  const magicLink = (email: string, client = newClient()) =>
    flows.authRoute.POST(
      flows.jsonPost(
        '/api/auth/sign-in/magic-link',
        { email },
        { [CLIENT_IP_HEADER]: client },
      ),
    );
  return {
    accounts,
    ...flows,
    magicLink,
    /** The global minute window elapsing: its real counter key expires. */
    elapseGlobalMinute: () => elapse(testApp, GLOBAL_MINUTE),
    /** Post-answer work (a saturated ceiling's sends and drops) finished. */
    settled: () => testApp.app.auth().settled(),
  };
}
