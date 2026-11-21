'use client';

import { Button } from '../components/button/button';
import { useState } from 'react';
import type { PaidHostingTier } from '@daisy/protocol/lobby/hosting-tier';
import {
  formatUsd,
  paidTierTitle,
} from '../../features/hosting-purchases/hosting-words';
import { buttonClass } from '../components/button/button-class';
import { Icon } from '../components/icon/icon';
import { eyebrowClass } from '../tab/list-card/list-card';
import { cn } from '../cn';

const included = [
  'Recording in every room',
  'Everything free hosting has',
  // AI judging and broadcast join when they reach event Rooms (ISSUE-1465, ISSUE-1466).
] as const;

/**
 * Upgrade one event (PYL-15): choose a tier, see what it costs today, and
 * post to checkout. The form posts the tier alone; the server decides the
 * amount. Before hydration it still posts, with the summary of the first
 * choice.
 */
export function UpgradeForm({
  tournament,
  options,
  initial,
  payerName,
  waitingEntries,
  action,
  notNowHref,
}: {
  readonly tournament: string;
  readonly options: readonly {
    readonly tier: PaidHostingTier;
    readonly owed: number;
    /** The tier's full price, shown on its card. */
    readonly price: number;
  }[];
  readonly initial: PaidHostingTier;
  readonly payerName: string;
  readonly waitingEntries: number;
  readonly action: string;
  readonly notNowHref: string;
}) {
  const [chosen, setChosen] = useState<PaidHostingTier>(initial);
  const current =
    options.find((option) => option.tier === chosen) ?? options[0]!;
  return (
    <form
      method="post"
      action={action}
      className="flex items-start gap-6 max-rail:flex-col"
    >
      <fieldset className="flex min-w-0 flex-2 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 font-strong">Entries</legend>
        <div className="flex gap-4 max-compact:flex-col">
          {options.map((option) => (
            <label
              key={option.tier}
              className={cn(
                'flex min-w-0 flex-1 cursor-pointer flex-col gap-3 rounded-lg bg-surface-raised p-5',
                option.tier === chosen
                  ? 'border-2 border-ink'
                  : 'border border-border-strong',
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="tier"
                    value={option.tier}
                    checked={option.tier === chosen}
                    onChange={() => setChosen(option.tier)}
                    className="m-0 size-5 accent-ink"
                  />
                  <strong className="text-lg">
                    {paidTierTitle[option.tier]}
                  </strong>
                </span>
                <span className="font-display text-3xl font-bold">
                  {formatUsd(option.price)}
                </span>
              </span>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {included.map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <Icon
                      name="check"
                      size={18}
                      className="shrink-0 text-sage-deep"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </label>
          ))}
        </div>
      </fieldset>
      <section
        aria-labelledby="upgrade-summary"
        className="flex min-w-0 flex-1 flex-col gap-3 rounded-lg bg-surface p-5 shadow-1"
      >
        <h2 id="upgrade-summary" className={eyebrowClass}>
          Summary
        </h2>
        <div className="flex justify-between gap-3">
          <span>
            {tournament}, {paidTierTitle[current.tier].toLowerCase()}
          </span>
          <strong>{formatUsd(current.owed, true)}</strong>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-3">
          <strong>Total today</strong>
          <strong className="font-display text-2xl">
            {formatUsd(current.owed, true)}
          </strong>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-strong">Who pays</span>
          <span>You ({payerName})</span>
          <span className="text-sm text-ink-muted">
            A receipt goes to the payer and shows in this event&rsquo;s Billing.
          </span>
        </div>
        {waitingEntries > 0 ? (
          <p className="m-0 text-sm text-ink-muted">
            {waitingEntries === 1
              ? 'The waiting entry can be accepted as soon as payment is confirmed.'
              : `The ${waitingEntries} waiting entries can be accepted as soon as payment is confirmed.`}
          </p>
        ) : null}
        <Button
          variant="unstyled"
          type="submit"
          className={cn(buttonClass('primary'), 'min-h-12 w-full text-base')}
        >
          <Icon name="card" size={18} />
          Continue to checkout · {formatUsd(current.owed)}
        </Button>
        <a href={notNowHref} className={cn(buttonClass('ghost'), 'w-full')}>
          Not now
        </a>
      </section>
    </form>
  );
}
