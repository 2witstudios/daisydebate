import { Announcement } from '../components/announcement/announcement';
import type { HostingAccountReadView } from '@daisy/protocol/lobby/hosting-read';
import {
  hostingOffers,
  hostingEntryCap,
} from '@daisy/protocol/lobby/hosting-tier';
import {
  entriesOfCap,
  formatUsd,
  hostingDate,
  paidTierTitle,
} from '../../features/hosting-purchases/hosting-words';
import { buttonClass } from '../components/button/button-class';
import { Icon } from '../components/icon/icon';
import { ListCard, ListHeading } from '../tab/list-card/list-card';
import { cn } from '../cn';

const rowButton = (variant: 'primary' | 'secondary') =>
  cn(
    buttonClass(variant),
    'min-h-room-target px-3 py-0 text-sm whitespace-nowrap',
  );

/**
 * The 17th entry on a free event, or the 65th on a USD 99 one (PYL-14): in
 * place on Entries, naming no counter beyond what the host already sees.
 */
export function EntryLimitNotice({
  account,
  upgradeHref,
}: {
  readonly account: HostingAccountReadView;
  readonly upgradeHref: string;
}) {
  const cap = account.entryCap;
  if (cap === null || account.waitingEntries === 0) return null;
  if (account.acceptedEntries < cap) return null;
  const free = account.tier === 'free';
  const asked =
    account.waitingEntries === 1
      ? 'An entry is waiting.'
      : `${account.waitingEntries} entries are waiting.`;
  return (
    <Announcement
      as="section"
      kind="progress"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-border-strong bg-surface-raised px-5 py-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <strong>
          {asked} The event is full on{' '}
          {free ? 'free hosting' : 'its plan of up to 64 entries'}.
        </strong>
        <span className="text-sm text-ink-muted">
          {free
            ? `Free hosting takes ${cap} entries. Upgrade this event to accept them: ${formatUsd(hostingOffers.event_64.unitAmount)} takes up to ${hostingEntryCap('event_64')}, ${formatUsd(hostingOffers.event_unlimited.unitAmount)} has no limit.`
            : `This event takes ${cap} entries. Move it to unlimited to accept them.`}{' '}
          {account.waitingEntries === 1
            ? 'Their request waits'
            : 'Their requests wait'}{' '}
          until you choose.
        </span>
      </div>
      <a href={upgradeHref} className={rowButton('primary')}>
        Upgrade this event
      </a>
    </Announcement>
  );
}

/**
 * Only recording reaches event Rooms today. AI judging and broadcast have
 * their switches but no event Room path yet (ISSUE-1465, ISSUE-1466), so
 * nothing promises them: they read as coming, on every tier.
 */
const features = [
  {
    key: 'recording',
    title: 'Recording',
    available: true,
    free: 'Not on free hosting. Paid events record every room.',
  },
  {
    key: 'ai_judging',
    title: 'AI judging',
    available: false,
    free: 'Coming to paid events.',
  },
  {
    key: 'broadcast',
    title: 'Broadcast',
    available: false,
    free: 'Coming to paid events.',
  },
] as const;

/**
 * Setup's video and judging switches (PYL-14). On free hosting each is off
 * and locked, beside its upgrade; on a paid event each shows its state.
 */
export function HostedFeatures({
  account,
  states,
  upgradeHref,
}: {
  readonly account: HostingAccountReadView;
  readonly states: Readonly<Record<(typeof features)[number]['key'], boolean>>;
  readonly upgradeHref: string;
}) {
  const free = account.tier === 'free';
  return (
    <ListCard>
      <ListHeading>Video and judging</ListHeading>
      <ul className="m-0 list-none p-0">
        {features.map((feature, index) => (
          <li
            key={feature.key}
            className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-3 first:border-t-0"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2">
              {free && feature.available ? (
                <Icon
                  name="lock"
                  size={18}
                  className="shrink-0 text-ink-muted"
                />
              ) : null}
              <div>
                <strong>{feature.title}</strong>
                <div className="text-sm text-ink-muted">
                  {free || !feature.available
                    ? feature.free
                    : states[feature.key]
                      ? 'On for this event.'
                      : 'Off for this event.'}
                </div>
              </div>
            </div>
            <span className="flex min-h-room-target items-center gap-2 text-ink-muted">
              <input
                type="checkbox"
                role="switch"
                disabled
                checked={!free && feature.available && states[feature.key]}
                readOnly
                aria-label={feature.title}
                className="size-5"
              />
              {!free && feature.available && states[feature.key] ? 'On' : 'Off'}
            </span>
            {free && feature.available ? (
              <a
                href={upgradeHref}
                className={rowButton(index === 0 ? 'primary' : 'secondary')}
                aria-label={`Upgrade this event: ${feature.title}`}
              >
                Upgrade this event
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </ListCard>
  );
}

/** The event's Billing (PYL-15): its hosting, its payments and receipts. */
export function HostingBilling({
  account,
  upgradeHref,
}: {
  readonly account: HostingAccountReadView;
  readonly upgradeHref: string;
}) {
  const settled = account.settled;
  const paidTotal = account.payments
    .filter((payment) => payment.state === 'paid')
    .reduce((sum, payment) => sum + payment.amount, 0);
  const move = account.upgrades.find(
    (option) => option.tier === 'event_unlimited',
  );
  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-6">
        <h2 className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
          Hosting for this event
        </h2>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-2xl font-bold">
            {account.tier === 'free'
              ? 'Free hosting'
              : paidTierTitle[account.tier]}
          </h3>
          <span className="font-strong">
            {account.covered
              ? 'Covered'
              : account.tier === 'free'
                ? `Up to ${account.entryCap} entries`
                : `${formatUsd(paidTotal)} · paid once`}
          </span>
        </div>
        <p className="m-0 text-ink-muted">
          {account.covered
            ? `This event's hosting is covered, so there is nothing to pay. ${entriesOfCap(account.acceptedEntries, null)} so far.`
            : settled
              ? `Paid by ${settled.payerName} on ${hostingDate(settled.at)}. ${entriesOfCap(account.acceptedEntries, null)} so far. Recording is on for this event.`
              : `${entriesOfCap(account.acceptedEntries, account.entryCap)}. Recording comes with an upgrade.`}
        </p>
        {account.covered ? null : account.tier === 'free' ? (
          <div>
            <a href={upgradeHref} className={rowButton('primary')}>
              Upgrade this event
            </a>
          </div>
        ) : move ? (
          <div>
            <a
              href={`${upgradeHref}?tier=event_unlimited`}
              className={rowButton('secondary')}
            >
              Move to unlimited · pay {formatUsd(move.owed)} more
            </a>
          </div>
        ) : null}
      </section>
      <section
        aria-labelledby="hosting-receipts"
        className="flex flex-col gap-3"
      >
        <h2
          id="hosting-receipts"
          className="text-xs font-heavy tracking-wider text-ink-muted uppercase"
        >
          Payments and receipts
        </h2>
        {account.payments.length === 0 ? (
          <p className="m-0 text-ink-muted">No payments for this event.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-surface text-ink-muted">
                <tr>
                  <th className="px-4 py-2 font-strong">Date</th>
                  <th className="px-4 py-2 font-strong">What</th>
                  <th className="px-4 py-2 font-strong">Paid by</th>
                  <th className="px-4 py-2 font-strong">Amount</th>
                  <th className="px-4 py-2 font-strong">Status</th>
                  <th className="px-4 py-2 font-strong">
                    <span className="sr-only">Receipt</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {account.payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <time dateTime={payment.at}>
                        {hostingDate(payment.at)}
                      </time>
                    </td>
                    <td className="px-4 py-3">
                      {account.name}:{' '}
                      {paidTierTitle[payment.tier].toLowerCase()}
                    </td>
                    <td className="px-4 py-3">{payment.payerName}</td>
                    <td className="px-4 py-3">
                      {formatUsd(payment.amount, true)}
                    </td>
                    <td className="px-4 py-3">
                      {payment.state === 'paid'
                        ? 'Paid'
                        : payment.state === 'open'
                          ? 'Waiting for payment'
                          : 'Not completed'}
                    </td>
                    <td className="px-4 py-3">
                      {payment.receiptUrl ? (
                        <a
                          href={payment.receiptUrl}
                          rel="noreferrer"
                          aria-label={`Receipt for ${hostingDate(payment.at)}`}
                          className="font-strong text-ink underline"
                        >
                          Receipt
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="m-0 text-sm text-ink-muted">
        Only this event&rsquo;s managers see this page. Stripe keeps the card
        and billing details; Daisy never stores them.
      </p>
    </>
  );
}
