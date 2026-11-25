import {
  billingSettingsSchema,
  holdsPremium,
} from '../../../features/billing/settings-view';
import { requestIdentity } from '../../../lib/page-reads';
import { GET } from '../../api/billing/settings/route';
import { readOwnRoute } from '../../../server/render-read';

/**
 * Whether this viewer already has Premium, so /premium does not offer it to
 * them. Only a member has a plan to read; a visitor, or a member whose plan
 * cannot be read, sees the offer.
 */
export const requestHoldsPremium = async (): Promise<boolean> =>
  (await requestIdentity()).state === 'member' &&
  holdsPremium(
    await readOwnRoute(GET, '/api/billing/settings', billingSettingsSchema),
  );
