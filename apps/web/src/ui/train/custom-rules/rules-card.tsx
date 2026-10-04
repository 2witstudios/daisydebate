import Link from 'next/link';
import {
  MAX_NAME_LENGTH,
  type CustomRulesQuery,
  type CustomRulesView,
} from '../../../features/train/custom-rules';
import { trainDestinations } from '../../../features/train/actions';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { chipClass } from '../choice/choice-class';

const link = 'no-underline hover:no-underline';

const stepButton =
  'inline-flex h-12 w-12 items-center justify-center rounded-sm border border-border-strong text-lg font-strong text-ink no-underline hover:no-underline';

function StepControl({
  label,
  href,
  symbol,
}: {
  readonly label: string;
  readonly href: string | null;
  readonly symbol: string;
}) {
  return href === null ? (
    <span
      role="link"
      aria-disabled="true"
      aria-label={label}
      className={cn(stepButton, 'cursor-not-allowed opacity-60')}
    >
      {symbol}
    </span>
  ) : (
    <Link href={href} aria-label={label} className={stepButton}>
      {symbol}
    </Link>
  );
}
type Props = {
  readonly view: CustomRulesView;
  readonly query: CustomRulesQuery;
};

/** The rules to change, and the name to give the set. */
export function RulesCards({ view, query }: Props) {
  return (
    <>
      <TrainCard title="Rules">
        {view.steppers.map((stepper) => (
          <div
            key={stepper.label}
            className="flex flex-wrap items-center gap-3"
          >
            <p className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-strong text-ink">
                {stepper.label}
              </span>
              <span className="text-sm text-ink-muted">{stepper.hint}</span>
            </p>
            <StepControl
              label={`Shorter ${stepper.label.toLowerCase()}`}
              href={stepper.shorterHref}
              symbol={'−'}
            />
            <span className="min-w-16 text-center text-md font-strong text-ink tabular-nums">{`${stepper.minutes} min`}</span>
            <StepControl
              label={`Longer ${stepper.label.toLowerCase()}`}
              href={stepper.longerHref}
              symbol="+"
            />
          </div>
        ))}
        <nav
          aria-label="Seats"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <span className="text-base font-strong text-ink">Seats</span>
          <ul className="flex flex-wrap gap-2">
            {view.seats.map((seat) => (
              <li key={seat.label}>
                <Link
                  href={seat.href}
                  aria-current={seat.selected ? 'true' : undefined}
                  className={cn(
                    chipClass,
                    link,
                    seat.selected && 'border-accent bg-accent-soft text-accent',
                  )}
                >
                  {seat.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </TrainCard>
      <TrainCard title="Name it">
        <form
          method="get"
          action={trainDestinations.customRules}
          className="flex flex-col gap-3"
        >
          <input
            type="hidden"
            name="speech"
            value={query.rules.speechMinutes}
          />
          <input type="hidden" name="prep" value={query.rules.prepMinutes} />
          <input type="hidden" name="seats" value={query.rules.seats} />
          {query.plan.mins !== 20 ? (
            <input type="hidden" name="mins" value={query.plan.mins} />
          ) : null}
          {query.plan.did.length > 0 ? (
            <input type="hidden" name="did" value={query.plan.did.join(',')} />
          ) : null}
          <label
            htmlFor="rule-set-name"
            className="text-sm font-strong text-ink"
          >
            Rule set name
          </label>
          <div className="flex flex-wrap gap-3">
            <input
              id="rule-set-name"
              type="text"
              name="name"
              defaultValue={query.name}
              maxLength={MAX_NAME_LENGTH}
              className="h-12 min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-3 text-base text-ink"
            />
            <button type="submit" className={buttonClass('secondary')}>
              Update name
            </button>
          </div>
        </form>
      </TrainCard>
    </>
  );
}
