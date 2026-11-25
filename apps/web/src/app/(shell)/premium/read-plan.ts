import {
  billingSettingsSchema,
  holdsPremium,
} from '../../../features/billing/settings-view';
import { requestIdentity } from '../../../lib/page-reads';
import { GET } from '../../api/billing/settings/route';
import { readOwnRoute } from '../../../server/render-read';

/** The accounts the billing settings route answers: a claimed username, whatever else is true of it. */
const claimed = new Set(['member', 'waitlisted', 'restricted']);

/**
 * Whether this viewer already has Premium, so /premium does not offer it to
 * them. A visitor or an account still being set up has no plan and is not
 * asked; an account whose plan cannot be read sees the offer, which leads to
 * the billing page and its own account of their plan.
 */
export const requestHoldsPremium = async (): Promise<boolean> =>
  claimed.has((await requestIdentity()).state) &&
  holdsPremium(
    await readOwnRoute(GET, '/api/billing/settings', billingSettingsSchema),
  );
