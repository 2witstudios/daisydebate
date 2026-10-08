import { setupRitewayBun } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';

/**
 * The suite header the integration files share: RITEway set up once and the
 * test services resolved, so a suite file starts at its own subject.
 */
export const integrationSuite = () => {
  setupRitewayBun();
  return requireTestServices(process.env);
};
