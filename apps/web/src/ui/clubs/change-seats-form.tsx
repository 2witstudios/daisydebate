'use client';

import { Announcement } from '../components/announcement/announcement';
import { useState } from 'react';
import {
  prorationEstimateMinor,
  type ClubBillingView,
  type ClubSeatsView,
} from '../../features/clubs/views';
import type { FormAction } from '../form-action/form-action';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { ClubForm } from './club-form';
import type { ClubFormState } from './club-form-state';
import { cents, day, dollars } from './club-copy';

type Plan = ClubBillingView['plan'];

/** What a seat change costs and when, in the board's words. */
export function seatChangeSummary(input: {
  readonly plan: Plan;
  readonly target: number;
  /** The instant the estimate is for; display only. */
  readonly now: string;
}): string {
  const { plan, target } = input;
  const monthly = dollars(plan.seatPriceMinor * target);
  if (target === plan.seatCount) return `${target} seats, ${monthly} a month.`;
  if (target < plan.seatCount)
    return `From today: ${target} seats, ${monthly} a month. Fewer seats take effect now, with no credit for the rest of this month.`;
  const added = target - plan.seatCount;
  const estimate =
    plan.periodStartsAt && plan.periodEndsAt
      ? prorationEstimateMinor({
          addedSeats: added,
          seatPriceMinor: plan.seatPriceMinor,
          periodStartsAt: plan.periodStartsAt,
          periodEndsAt: plan.periodEndsAt,
          now: input.now,
        })
      : null;
  const next = plan.renewsAt
    ? ` Your ${day(plan.renewsAt)} invoice is ${cents(plan.seatPriceMinor * target)}.`
    : '';
  return `From today: ${target} seats, ${monthly} a month. ${
    estimate === null
      ? 'You pay for the new seats now'
      : `You pay about ${cents(estimate)} now`
  } for the ${added} new ${added === 1 ? 'seat' : 'seats'} for the rest of this period.${next}`;
}

/**
 * Change seats (RClubBilling). An increase is paid now and lands once paid;
 * going below the seats in use asks exactly who gives a seat up.
 */
export function ChangeSeatsForm({
  action,
  plan,
  seating,
  now,
}: {
  readonly action: FormAction<ClubFormState>;
  readonly plan: Plan;
  /** The request's instant, for the proration estimate; display only. */
  readonly now: string;
  readonly seating: Pick<ClubSeatsView, 'seats' | 'invitations'>;
}) {
  const [target, setTarget] = useState(plan.seatCount);
  const live = seating.invitations.filter((invitation) => !invitation.expired);
  const release = Math.max(0, plan.seatsUsed - target);
  const filled = seating.seats.length;
  const clamp = (value: number) => Math.min(200, Math.max(1, value));
  return (
    <ClubForm
      action={action}
      label="Change seats"
      focusTarget="seat-count"
      className="flex flex-col gap-4"
    >
      {({ pending, done }) => (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="seat-count" className="text-sm font-strong">
              Seats
            </label>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                aria-label="One seat fewer"
                onClick={() => setTarget((value) => clamp(value - 1))}
              >
                −
              </Button>
              <input
                id="seat-count"
                name="seatCount"
                type="number"
                min={1}
                max={200}
                value={target}
                onChange={(event) =>
                  setTarget(clamp(Number(event.target.value) || 1))
                }
                className={`${controlClass} w-club-count text-center`}
              />
              <Button
                variant="secondary"
                aria-label="One seat more"
                onClick={() => setTarget((value) => clamp(value + 1))}
              >
                +
              </Button>
            </div>
            <p className="text-sm text-ink-faint">
              You have {filled} filled and {live.length} invited, so the lowest
              without giving up a seat is {plan.lowestSeatCount}.
            </p>
          </div>
          <p className="font-strong">
            {seatChangeSummary({ plan, target, now })}
          </p>
          {release > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-strong">
                Choose {release} {release === 1 ? 'seat' : 'seats'} to give up
              </legend>
              <p className="text-sm text-ink-muted">
                People you choose stay members and drop to the free plan at the
                end of today (UTC). Invitations you choose are cancelled.
              </p>
              {seating.seats.map((seat) => (
                <label key={seat.userId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="releaseSeat"
                    value={seat.userId}
                  />
                  {seat.name}
                </label>
              ))}
              {live.map((invitation) => (
                <label key={invitation.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="releaseInvitation"
                    value={invitation.id}
                  />
                  {invitation.email} (invited)
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={pending || target === plan.seatCount}
            >
              Update to {target} {target === 1 ? 'seat' : 'seats'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setTarget(plan.seatCount)}
            >
              Cancel
            </Button>
          </div>
          {done ? (
            <Announcement
              as="p"
              kind="progress"
              className="text-sm text-ink-muted"
            >
              Seats updated. The new count shows once Stripe confirms it.
            </Announcement>
          ) : null}
        </>
      )}
    </ClubForm>
  );
}
