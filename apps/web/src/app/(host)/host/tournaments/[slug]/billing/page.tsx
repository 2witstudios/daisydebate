import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { idSchema } from '@daisy/protocol';
import { hostingAccountViewSchema } from '@daisy/protocol/lobby/hosting-read';
import { hostingAccountPath } from '../../../../../../features/hosting-purchases/routes';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { requireHostTiersRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { PageHeader } from '../../../../../../ui/components/page-header/page-header';
import { HostingBilling } from '../../../../../../ui/hosting/hosting-panels';
import { HostShell } from '../../../../../../ui/tab/host-shell/host-shell';
import { GET } from '../../../../../api/tab/hosting/route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { readStoredHostNavigation } from '../../../read-navigation';

export const metadata: Metadata = { title: 'Billing' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ purchase?: string }>;
}) {
  await requireHostTiersRelease();
  const { slug } = await params;
  const { purchase } = await searchParams;
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  // Back from Checkout: the read settles that purchase if Stripe has finished.
  const returned = idSchema.safeParse(purchase);
  const account = await readOwnRoute(
    GET,
    hostingAccountPath(slug, returned.success ? returned.data : undefined),
    hostingAccountViewSchema,
  );
  if (!account) notFound();
  return (
    <HostShell rail={hostNavigationRail(navigation)} current="billing">
      <PageHeader title="Billing" lede={`${account.name} · Freestyle`} />
      <HostingBilling
        account={account}
        upgradeHref={hostRoutes.upgrade(slug)}
      />
    </HostShell>
  );
}
