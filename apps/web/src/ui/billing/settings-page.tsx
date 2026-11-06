import Link from 'next/link';
import type { BillingSettings } from '../../features/billing/settings-view';
import { Button } from '../components/button/button';
import { PageHeader } from '../components/page-header/page-header';
import { Panel } from '../components/panel/panel';
import { ReadingPage } from '../components/reading-page/reading-page';

const notices = {
  'purchase-pending':
    'Your purchase is being checked. Your access updates after payment is confirmed.',
  'billing-unavailable': 'Billing is unavailable. Try again.',
} as const;
export function BillingSettingsPage({
  settings,
  notice,
}: {
  readonly settings: BillingSettings | null;
  readonly notice?: string;
}) {
  const message =
    notice && Object.hasOwn(notices, notice)
      ? notices[notice as keyof typeof notices]
      : null;
  return (
    <ReadingPage>
      <PageHeader title="Billing" />
      {message ? <p role="status">{message}</p> : null}
      {!settings ? (
        <Panel title="Billing unavailable">
          <p>Try again.</p>
        </Panel>
      ) : (
        <>
          <Panel
            title={
              settings.plan === 'premium'
                ? 'Daisy Premium'
                : settings.plan === 'payment-due'
                  ? 'Payment needs attention'
                  : 'Free account'
            }
          >
            <div className="flex flex-col gap-3">
              {settings.accessEndsAt ? (
                <p>
                  {settings.plan === 'payment-due'
                    ? 'Payment grace ends'
                    : 'Paid through'}{' '}
                  <time dateTime={settings.accessEndsAt}>
                    {settings.accessEndsAt.slice(0, 10)}
                  </time>
                  .
                </p>
              ) : null}
              {settings.manageAvailable ? (
                <form action="/api/billing/portal" method="post">
                  <Button type="submit">Manage billing or cancel</Button>
                </form>
              ) : null}
              {settings.checkoutAvailable ? (
                <form action="/api/billing/checkout" method="post">
                  <Button type="submit">Get Premium · USD 10/month</Button>
                </form>
              ) : null}
              <Link href="/premium" className="underline">
                Premium features and terms
              </Link>
            </div>
          </Panel>
          <Panel title="Bot debates">
            {settings.botDebates.kind === 'unavailable' ? (
              <p>Usage unavailable.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p>
                  {settings.botDebates.remaining} of {settings.botDebates.limit}{' '}
                  debates remaining
                  {settings.botDebates.scope === 'lifetime'
                    ? ' · one lifetime allowance'
                    : settings.botDebates.scope === 'beta-month'
                      ? ' · this beta month'
                      : ' · this billing period'}
                  .
                </p>
                {settings.botDebates.endsAt ? (
                  <p>
                    Period ends{' '}
                    <time dateTime={settings.botDebates.endsAt}>
                      {settings.botDebates.endsAt.slice(0, 10)}
                    </time>
                    .
                  </p>
                ) : null}
                {!settings.botDebates.available ? (
                  <Link href="/premium" className="underline">
                    Explore Premium
                  </Link>
                ) : null}
              </div>
            )}
          </Panel>
        </>
      )}
    </ReadingPage>
  );
}
