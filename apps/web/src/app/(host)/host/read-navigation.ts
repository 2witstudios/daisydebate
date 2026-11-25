import { hostTiersReleased } from '../../../features/tab/release';
import { hostNavigationViewSchema } from '@daisy/protocol/lobby/host-navigation-read';
import { hostNavigationPath } from '../../../features/tab/host-navigation-route';
import { readOwnRoute } from '../../../server/render-read';
import { GET } from '../../api/tab/host-navigation/route';

/**
 * Shell metadata passes the same evaluated request boundary as every area;
 * a tournament's Billing shows while host tiers are released (ADR 0149).
 */
export const readStoredHostNavigation = async (
  kind: 'organization' | 'lobby',
  handle: string,
) => {
  const view = await readOwnRoute(
    GET,
    hostNavigationPath(kind, handle),
    hostNavigationViewSchema,
  );
  return view && { ...view, billing: await hostTiersReleased() };
};
