import { Announcement } from '../components/announcement/announcement';
import Link from 'next/link';
import type { BillingSettings } from '../../features/billing/settings-view';
import {
  monthlyPrice,
  premiumOfferPrice,
} from '../../features/billing/premium-price';
import { Button } from '../components/button/button';
import { buttonClass } from '../components/button/button-class';
import { Icon } from '../components/icon/icon';
import { PageHeader } from '../components/page-header/page-header';
import { Panel } from '../components/panel/panel';
import { ReadingPage } from '../components/reading-page/reading-page';

const notices = {
  'purchase-pending':
    'Your purchase is being checked. Your access updates after payment is confirmed.',
  'billing-unavailable': 'Billing is unavailable. Try again.',
} as const;

const day = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
/** "17 Dec 2026" in UTC, the instant the verified period ends. */
function Day({
  at,
  strong = false,
}: {
  readonly at: string;
  readonly strong?: boolean;
}) {
  const text = day.format(new Date(at));
  return <time dateTime={at}>{strong ? <strong>{text}</strong> : text}</time>;
}

const secondary = `${buttonClass('secondary')} min-h-nav-target self-start`;

function Portal({
  children,
  variant = 'primary',
}: {
  readonly children: string;
  readonly variant?: 'primary' | 'secondary';
}) {
  return (
    <form action="/api/billing/portal" method="post" className="self-start">
      <Button type="submit" variant={variant}>
        {children}
      </Button>
    </form>
  );
}
function Terms() {
  return (
    <Link href="/premium" className={secondary}>
      Premium features and terms
    </Link>
  );
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();

function PlanPanel({ settings }: { readonly settings: BillingSettings }) {
  const ends = settings.accessEndsAt;
  switch (settings.plan) {
    case 'premium':
      return (
        <Panel title="Daisy Premium">
          <div className="flex flex-col gap-3">
            {settings.priceMinor ? (
              <p className="text-lg">
                <strong>{monthlyPrice(settings.priceMinor)}</strong>
              </p>
            ) : null}
            {ends ? (
              <p>
                Renews <Day at={ends} />.
              </p>
            ) : null}
            {settings.manageAvailable ? (
              <Portal>Manage billing or cancel</Portal>
            ) : null}
            <Terms />
          </div>
        </Panel>
      );
    case 'cancelled':
      return (
        <Panel title="Daisy Premium · cancelled">
          <div className="flex flex-col gap-3">
            {ends ? (
              <p>
                Renewal is off. Premium stays on until <Day at={ends} strong />,
                then this becomes a free account.
              </p>
            ) : null}
            <p className="text-sm text-ink-muted">
              Your analysis and Recordings stay yours after that.
            </p>
            {settings.manageAvailable ? (
              <>
                <Portal>Keep Premium</Portal>
                <Portal variant="secondary">Manage billing</Portal>
              </>
            ) : null}
          </div>
        </Panel>
      );
    case 'granted':
      return (
        <Panel title="Daisy Premium">
          <div className="flex flex-col gap-3">
            <p>
              Premium is included with your beta access, so there is nothing to
              pay.
            </p>
            {settings.manageAvailable ? (
              <Portal variant="secondary">Manage billing</Portal>
            ) : null}
            <Terms />
          </div>
        </Panel>
      );
    case 'club-seat':
      return (
        <Panel title="Daisy Premium">
          <div className="flex flex-col gap-3">
            {settings.club ? (
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 items-center justify-center rounded-lg bg-surface-sunken text-xs font-bold"
                >
                  {initials(settings.club.name)}
                </span>
                <div>
                  <strong>Seat from {settings.club.name}</strong>
                  <div className="text-sm text-ink-muted">
                    Coach: {settings.club.manager}
                  </div>
                </div>
              </div>
            ) : null}
            <p>
              Your club pays for your seat, so there is nothing to manage here.
              Ask your coach if you want to change it.
            </p>
            <Link href="/messages" className={secondary}>
              Message your coach
            </Link>
            <Terms />
          </div>
        </Panel>
      );
    case 'payment-due':
      return (
        <Panel title="Payment needs attention">
          <div className="flex flex-col gap-3">
            {ends ? (
              <p>
                Payment grace ends <Day at={ends} />.
              </p>
            ) : null}
            {settings.manageAvailable ? (
              <Portal>Manage billing or cancel</Portal>
            ) : null}
            <Terms />
          </div>
        </Panel>
      );
    case 'free':
      return (
        <Panel title="Free account">
          <div className="flex flex-col gap-3">
            {settings.checkoutAvailable ? (
              <form
                action="/api/billing/checkout"
                method="post"
                className="self-start"
              >
                <Button type="submit">Get Premium · {premiumOfferPrice}</Button>
              </form>
            ) : null}
            {settings.manageAvailable ? (
              <Portal variant="secondary">Manage billing</Portal>
            ) : null}
            <Terms />
          </div>
        </Panel>
      );
  }
}

/** What Premium includes; bot debates are no part of it (BCS-7). */
const included = [
  ['Ask for analysis', 'On any Round you debated.'],
  ['AI judge', 'On the casual Rounds you host.'],
  ['Record and broadcast', 'Turn it on when you host a casual Room.'],
  ['Download Recordings', 'Any Recording you can watch.'],
] as const;

/** The checkout return once current server evidence shows Premium, never the return URL alone. */
function PremiumConfirmed({
  settings,
}: {
  readonly settings: BillingSettings;
}) {
  return (
    <Announcement
      as="section"
      kind="progress"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-6"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-12 items-center justify-center rounded-full bg-sage text-ink"
        >
          <Icon name="check" size={22} />
        </span>
        <h2 className="font-display text-2xl font-bold">You have Premium</h2>
      </div>
      <p>
        Payment confirmed.{' '}
        {settings.priceMinor ? (
          <>
            {monthlyPrice(settings.priceMinor)}
            {settings.accessEndsAt ? (
              <>
                , renewing <Day at={settings.accessEndsAt} />
              </>
            ) : null}
            .{' '}
          </>
        ) : settings.accessEndsAt ? (
          <>
            Renewing <Day at={settings.accessEndsAt} />.{' '}
          </>
        ) : null}
        A receipt is on its way to your email.
      </p>
      <div className="grid gap-3 narrow:grid-cols-2">
        {included.map(([title, body]) => (
          <div
            key={title}
            className="flex flex-col gap-1 rounded-lg bg-surface p-4"
          >
            <strong>{title}</strong>
            <span className="text-sm text-ink-muted">{body}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/play"
          className={`${buttonClass('primary')} min-h-nav-target`}
        >
          Play a debate
        </Link>
        <Link href="/settings/billing" className={secondary}>
          Back to billing
        </Link>
      </div>
    </Announcement>
  );
}

/** Billing has no usage counters (PYL-10): the plan, its price and its dates. */
export function BillingSettingsPage({
  settings,
  notice,
  returned = false,
}: {
  readonly settings: BillingSettings | null;
  readonly notice?: string;
  /** Arrived from Checkout: confirmed only when current evidence is Premium. */
  readonly returned?: boolean;
}) {
  const confirmed = returned && settings?.plan === 'premium';
  const message = confirmed
    ? null
    : returned
      ? notices['purchase-pending']
      : notice && Object.hasOwn(notices, notice)
        ? notices[notice as keyof typeof notices]
        : null;
  return (
    <ReadingPage>
      <PageHeader title="Billing" />
      {message ? (
        <Announcement
          as="p"
          kind="progress"
          className="rounded-lg bg-surface-sunken px-4 py-3"
        >
          {message}
        </Announcement>
      ) : null}
      {!settings ? (
        <Panel title="Billing unavailable">
          <p>Try again.</p>
        </Panel>
      ) : confirmed ? (
        <PremiumConfirmed settings={settings} />
      ) : (
        <PlanPanel settings={settings} />
      )}
    </ReadingPage>
  );
}
