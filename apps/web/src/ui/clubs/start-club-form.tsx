'use client';

import { useState } from 'react';
import type { FormAction } from '../form-action/form-action';
import { Button } from '../components/button/button';
import { controlClass } from '../components/form-field/form-field-class';
import { FormField } from '../components/form-field/form-field';
import { ClubForm } from './club-form';
import type { ClubFormState } from './club-form-state';
import { cents, dollars } from './club-copy';
import { clubSeatOffer } from '../../features/billing/club-price';

const SEAT_PRICE_MINOR = clubSeatOffer.unitAmount;

/** The board's three kinds; a debate club outside a school is the school kind. */
const clubKindChoices = [
  {
    value: 'school',
    label: 'School',
    detail: 'A school team.',
  },
  {
    value: 'family',
    label: 'Homeschool family',
    detail: 'A parent seating their own children.',
  },
  {
    value: 'club',
    label: 'Club',
    detail: 'A debate club outside a school.',
  },
] as const;

/** Start a club (RClubCreate): its name, kind and seats, then Checkout. */
export function StartClubForm({
  action,
}: {
  readonly action: FormAction<ClubFormState>;
}) {
  const [seats, setSeats] = useState(1);
  const clamp = (value: number) => Math.min(200, Math.max(1, value));
  const total = SEAT_PRICE_MINOR * seats;
  return (
    <ClubForm
      action={action}
      label="Start a club"
      focusTarget="club-name"
      className="grid grid-cols-club-start items-start gap-6 max-compact:grid-cols-1"
    >
      {({ values, pending }) => (
        <>
          <div className="flex flex-col gap-5 rounded-xl bg-surface p-6 shadow-1">
            <FormField
              id="club-name"
              label="Club name"
              helper="Students see this when you invite them."
            >
              <input
                id="club-name"
                name="name"
                type="text"
                required
                minLength={2}
                maxLength={80}
                defaultValue={values.name ?? ''}
                className={controlClass}
              />
            </FormField>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-strong">
                What kind of club?
              </legend>
              {clubKindChoices.map((choice) => (
                <label
                  key={choice.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-checked:border-ink"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={choice.value}
                    required
                    defaultChecked={(values.kind ?? 'school') === choice.value}
                    className="mt-1"
                  />
                  <span className="flex flex-col">
                    <strong>{choice.label}</strong>
                    <span className="text-sm text-ink-muted">
                      {choice.detail}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="flex flex-col gap-1">
              <label htmlFor="club-seat-count" className="text-sm font-strong">
                Seats
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  aria-label="One seat fewer"
                  onClick={() => setSeats((value) => clamp(value - 1))}
                >
                  −
                </Button>
                <input
                  id="club-seat-count"
                  name="seats"
                  type="number"
                  min={1}
                  max={200}
                  value={seats}
                  onChange={(event) =>
                    setSeats(clamp(Number(event.target.value) || 1))
                  }
                  className={`${controlClass} w-club-count text-center`}
                />
                <Button
                  variant="secondary"
                  aria-label="One seat more"
                  onClick={() => setSeats((value) => clamp(value + 1))}
                >
                  +
                </Button>
              </div>
              <p className="text-sm text-ink-faint">
                One seat is Premium for one student. Add, move or remove seats
                any time.
              </p>
            </div>
          </div>
          <aside
            aria-label="Club plan"
            className="flex flex-col gap-3 rounded-xl bg-surface p-6 shadow-1"
          >
            <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
              Club plan
            </span>
            <p>
              <strong className="font-display text-3xl">
                {dollars(total)}
              </strong>{' '}
              <span className="text-ink-muted">a month</span>
            </p>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt>
                  {seats} {seats === 1 ? 'seat' : 'seats'} ×{' '}
                  {dollars(SEAT_PRICE_MINOR)}
                </dt>
                <dd className="tabular-nums">{cents(total)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Billed</dt>
                <dd>Monthly, to the club</dd>
              </div>
            </dl>
            <ul className="flex flex-col gap-1 text-sm text-ink-muted">
              <li>
                Every seat gets Premium: unlimited bot Rounds, AI judging and
                analysis.
              </li>
              <li>Adding seats mid-month is charged for the days left.</li>
              <li>Taxes are added at checkout where they apply.</li>
            </ul>
            <Button type="submit" disabled={pending}>
              Continue to checkout
            </Button>
            <p className="text-sm text-ink-faint">
              You pay on the next page. Cancel any time; seats end with the
              month.
            </p>
          </aside>
        </>
      )}
    </ClubForm>
  );
}
