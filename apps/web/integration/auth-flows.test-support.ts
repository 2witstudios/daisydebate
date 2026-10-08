import { setupRitewayBun } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createPasskeyFlows } from './auth-passkey-flows';

/**
 * The signed-in flows the auth suites drive, with services required once:
 * the recorded outbox events, the account client, its sign-up flow, and the
 * whole flows object for suites that need more.
 */
export const authFlows = async () => {
  requireTestServices(process.env);
  setupRitewayBun();
  const flows = await createPasskeyFlows();
  return {
    flows,
    recordedEvents: flows.recordedEvents,
    newClient: flows.account.flows.newClient,
    signUp: flows.account.signUp,
  };
};
