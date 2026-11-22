import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { hostingAccountViewSchema } from '@daisy/protocol/lobby/hosting-read';
import {
  hostingOffers,
  isHostingTier,
} from '@daisy/protocol/lobby/hosting-tier';
import {
  hostingAccountPath,
  hostingCheckoutPath,
  hostingUnavailableNotice,
} from '../../../../../../features/hosting-purchases/routes';
import { hostNavigationRail } from '../../../../../../features/tab/host-navigation';
import { requireHostTiersRelease } from '../../../../../../features/tab/release';
import { hostRoutes } from '../../../../../../features/tab/routes';
import {
  requestIdentity,
  requestOwnProfileCard,
} from '../../../../../../lib/request-session';
import { PageHeader } from '../../../../../../ui/components/page-header/page-header';
import { Notice } from '../../../../../../ui/components/notice/notice';
import { UpgradeForm } from '../../../../../../ui/hosting/upgrade-form';
import { HostShell } from '../../../../../../ui/tab/host-shell/host-shell';
import { GET } from '../../../../../api/tab/hosting/route';
import { readOwnRoute } from '../../../../../(shell)/friends/read-route';
import { readStoredHostNavigation } from '../../../read-navigation';

export const metadata: Metadata = { title: 'Upgrade this event' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ tier?: string; notice?: string }>;
}) {
  await requireHostTiersRelease();
  const { slug } = await params;
  const { tier, notice } = await searchParams;
  const navigation = await readStoredHostNavigation('lobby', slug);
  if (!navigation) notFound();
  const account = await readOwnRoute(
    GET,
    hostingAccountPath(slug),
    hostingAccountViewSchema,
  );
  if (!account) notFound();
  // Nothing left to buy: the event's Billing says what it has.
  if (account.upgrades.length === 0) redirect(hostRoutes.billing(slug));
  const identity = await requestIdentity();
  const payer =
    identity.state === 'member'
      ? ((await requestOwnProfileCard(identity.principal.actorId))
          .displayName ?? 'your account')
      : 'your account';
  const options = account.upgrades.map((option) => ({
    ...option,
    price: hostingOffers[option.tier].unitAmount,
  }));
  const wanted =
    typeof tier === 'string' && isHostingTier(tier) && tier !== 'free'
      ? tier
      : null;
  const initial =
    options.find((option) => option.tier === wanted)?.tier ?? options[0]!.tier;
  return (
    <HostShell rail={hostNavigationRail(navigation)} current="billing">
      <PageHeader
        title="Upgrade this event"
        lede={`${account.name} · Freestyle. One payment for this event; nothing renews.`}
      />
      {notice === hostingUnavailableNotice ? (
        <Notice
          tone="gold"
          icon="alert"
          title="Checkout is not available right now."
          role="status"
        >
          Nothing was charged. Try again in a moment.
        </Notice>
      ) : null}
      <UpgradeForm
        tournament={account.name}
        options={options}
        initial={initial}
        payerName={payer}
        waitingEntries={account.waitingEntries}
        action={hostingCheckoutPath(slug)}
        notNowHref={hostRoutes.entries(slug)}
      />
    </HostShell>
  );
}
