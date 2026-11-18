import type {
  ClubBillingView,
  ClubSeatsView,
} from '../../features/clubs/views';
import type { FormAction } from '../form-action/form-action';
import { Button } from '../components/button/button';
import { PageHeader } from '../components/page-header/page-header';
import { Panel } from '../components/panel/panel';
import { ClubFrame } from './club-frame';
import { cents, day, dollars, planLine, seatTally } from './club-copy';
import type { ClubFormState } from './club-form-state';
import { ChangeSeatsForm } from './change-seats-form';

export const clubBillingNotices = {
  'purchase-pending':
    'Your purchase is being checked. Seats start once payment is confirmed.',
  'billing-unavailable': 'Club billing is unavailable. Try again.',
} as const;
export type ClubBillingNotice = keyof typeof clubBillingNotices;

type Invoice = ClubBillingView['invoices'][number];
const invoiceLabel = (invoice: Invoice) =>
  invoice.kind === 'renewal'
    ? 'Seats, monthly'
    : invoice.kind === 'seat-change'
      ? 'Seats added, prorated'
      : 'Invoice';
const statusLabel: Readonly<Record<Invoice['status'], string>> = {
  paid: 'Paid',
  open: 'Due',
  void: 'Void',
  uncollectible: 'Unpaid',
  draft: 'Draft',
};

function Portal({
  club,
  children,
  variant = 'secondary',
}: {
  readonly club: string;
  readonly children: string;
  readonly variant?: 'primary' | 'secondary';
}) {
  return (
    <form action={`/api/clubs/${club}/billing/portal`} method="post">
      <Button type="submit" variant={variant}>
        {children}
      </Button>
    </form>
  );
}

function Fact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="font-strong">{value}</dd>
    </div>
  );
}

/** Before a first payment: Checkout for the seats chosen when the club started. */
function Checkout({ view }: { readonly view: ClubBillingView }) {
  return (
    <Panel title="Club plan">
      <form
        action={`/api/clubs/${view.club.id}/billing/checkout`}
        method="post"
        className="flex flex-col gap-3"
      >
        <label htmlFor="checkout-seats" className="text-sm font-strong">
          Seats
        </label>
        <input
          id="checkout-seats"
          name="seats"
          type="number"
          min={Math.max(1, view.plan.seatsUsed)}
          max={200}
          defaultValue={Math.max(1, view.plan.seatsUsed, view.plan.seatCount)}
          className="h-12 w-club-count rounded-md border border-border bg-surface-raised px-3 text-center"
        />
        <p className="text-sm text-ink-muted">
          {dollars(view.plan.seatPriceMinor)} per seat a month, billed to the
          club. Taxes are added at checkout where they apply.
        </p>
        <Button type="submit" className="self-start">
          Continue to checkout
        </Button>
      </form>
    </Panel>
  );
}

/**
 * Club billing (RClubBilling): the plan, changing seats, invoices and
 * cancelling. Card, invoices to download and cancellation are Stripe's
 * portal; the seat count is changed here only.
 */
export function ClubBillingPage({
  view,
  seating,
  notice,
  returned = false,
  now,
  action,
}: {
  readonly view: ClubBillingView;
  readonly seating: ClubSeatsView;
  readonly notice?: ClubBillingNotice;
  readonly returned?: boolean;
  /** The request's instant, for a seat increase's estimate. */
  readonly now: string;
  readonly action: FormAction<ClubFormState>;
}) {
  const { plan, club } = view;
  const tally = seatTally(seating);
  const active =
    plan.state === 'active' ||
    plan.state === 'cancelled' ||
    plan.state === 'payment-due';
  return (
    <ClubFrame view={seating} section="billing">
      <PageHeader
        title="Billing"
        lede={`One bill for ${club.name}. ${dollars(plan.seatPriceMinor)} per seat a month; every seat is Premium.`}
      />
      {notice ? (
        <p role="status" className="rounded-xl bg-surface-sunken p-4">
          {clubBillingNotices[notice]}
        </p>
      ) : returned && plan.state === 'none' ? (
        <p role="status" className="rounded-xl bg-surface-sunken p-4">
          Your seats are being confirmed. This page updates once payment is
          confirmed.
        </p>
      ) : null}
      {plan.state === 'none' ? (
        view.purchaseAvailable ? (
          <Checkout view={view} />
        ) : null
      ) : (
        <Panel title="Club plan">
          <div className="flex flex-col gap-5">
            <p>
              <strong className="font-display text-3xl">
                {dollars(plan.monthlyTotalMinor)}
              </strong>{' '}
              <span className="text-ink-muted">a month</span>
            </p>
            <dl className="grid grid-cols-club-facts gap-4">
              <Fact
                label="Seats"
                value={`${plan.seatCount} × ${dollars(plan.seatPriceMinor)}`}
              />
              <Fact
                label="Filled"
                value={`${tally.filled}, with ${tally.invited} invited`}
              />
              <Fact label="Status" value={planLine(plan)} />
              {plan.state === 'active' && plan.renewsAt ? (
                <Fact
                  label="Next invoice"
                  value={`${day(plan.renewsAt)} · ${cents(plan.monthlyTotalMinor)}`}
                />
              ) : null}
            </dl>
            {view.portalAvailable ? (
              <div className="flex flex-wrap gap-3">
                <Portal club={club.id}>Manage payment</Portal>
                <Portal club={club.id}>Download invoices</Portal>
              </div>
            ) : null}
          </div>
        </Panel>
      )}
      {active && view.purchaseAvailable ? (
        <section
          id="change-seats"
          aria-labelledby="change-seats-heading"
          className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
        >
          <h2
            id="change-seats-heading"
            className="font-display text-xl font-bold"
          >
            Change seats
          </h2>
          <ChangeSeatsForm
            action={action}
            plan={plan}
            seating={seating}
            now={now}
          />
        </section>
      ) : null}
      {view.invoices.length > 0 ? (
        <section
          aria-labelledby="invoices-heading"
          className="flex flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
        >
          <h2 id="invoices-heading" className="font-display text-xl font-bold">
            Invoices
          </h2>
          <table className="w-full text-left">
            <thead className="text-xs font-bold tracking-widest text-ink-muted uppercase">
              <tr>
                <th className="py-2">Date</th>
                <th className="py-2">Description</th>
                <th className="py-2">Amount</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-border">
                  <td className="py-3">{day(invoice.date)}</td>
                  <td className="py-3">{invoiceLabel(invoice)}</td>
                  <td className="py-3 tabular-nums">
                    {cents(invoice.totalMinor)}
                  </td>
                  <td className="py-3">{statusLabel[invoice.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {active && plan.state !== 'cancelled' && view.portalAvailable ? (
        <section
          aria-labelledby="cancel-heading"
          className="flex flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
        >
          <h2 id="cancel-heading" className="font-display text-xl font-bold">
            Cancel the club
          </h2>
          <p className="text-ink-muted">
            {plan.renewsAt
              ? `Seats stay Premium until ${day(plan.renewsAt)}, then students move to the free plan.`
              : 'Seats stay Premium until the end of the paid month, then students move to the free plan.'}
          </p>
          <Portal club={club.id}>Cancel the club</Portal>
        </section>
      ) : null}
    </ClubFrame>
  );
}
