import type { Metadata } from 'next';
import { requireAccess } from '../../../../lib/access';
import type { SearchParams } from '../../../../features/access/decision';
import { billingSettingsSchema } from '../../../../features/billing/settings-view';
import { BillingSettingsPage } from '../../../../ui/billing/settings-page';
import { readOwnRoute } from '../../friends/read-route';
import { GET } from '../../../api/billing/settings/route';
export const metadata: Metadata = { title: 'Billing' };

/** Return parameters are notices only; paid access comes from current server evidence. */
export default async function Billing({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings/billing', searchParams);
  const query = await searchParams;
  const settings = await readOwnRoute(
    GET,
    '/api/billing/settings',
    billingSettingsSchema,
  );
  const notice =
    typeof query.notice === 'string'
      ? query.notice
      : typeof query.purchase === 'string'
        ? 'purchase-pending'
        : undefined;
  return (
    <BillingSettingsPage
      settings={settings}
      {...(notice === undefined ? {} : { notice })}
    />
  );
}
