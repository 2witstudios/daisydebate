import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PlanAction } from '../../features/pricing/plan-actions';
import { buttonClass } from '../components/button/button-class';
import { cn } from '../cn';
import { FeatureList } from './feature-list';

/**
 * One plan on /pricing: who it is for, its name and price, a one-line
 * summary, what it includes and its primary action, pinned to the card's
 * foot so the four actions line up. The featured plan (Premium) carries the
 * strong outline and the primary button; the others are quieter.
 */
export function PlanCard({
  audience,
  name,
  price,
  period,
  summary,
  features,
  action,
  featured = false,
  children,
}: {
  readonly audience: string;
  readonly name: string;
  readonly price: string;
  readonly period?: string;
  readonly summary: string;
  readonly features: readonly string[];
  readonly action: PlanAction;
  readonly featured?: boolean;
  /** Anything between the summary and the features (Host's tiers). */
  readonly children?: ReactNode;
}) {
  const headingId = `plan-${name.toLowerCase()}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-xl bg-surface-raised p-6',
        featured ? 'border-2 border-accent' : 'border border-border',
      )}
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs font-bold tracking-wider text-ink-muted uppercase">
          {audience}
        </p>
        <h2
          id={headingId}
          className="font-display text-xl leading-tight font-bold"
        >
          {name}
        </h2>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-2xl font-bold">{price}</span>
          {period ? <span className="text-ink-muted">{period}</span> : null}
        </p>
        <p className="text-ink-muted">{summary}</p>
      </div>
      {children}
      <FeatureList items={features} />
      <div className="mt-auto flex flex-col">
        <PlanActionControl action={action} featured={featured} />
      </div>
    </section>
  );
}

function PlanActionControl({
  action,
  featured,
}: {
  readonly action: PlanAction;
  readonly featured: boolean;
}) {
  switch (action.kind) {
    case 'link':
      return (
        <Link
          href={action.href}
          className={cn(
            buttonClass(featured ? 'primary' : 'secondary'),
            'min-h-nav-target w-full whitespace-nowrap no-underline hover:no-underline',
          )}
        >
          {action.label}
        </Link>
      );
    case 'coming-soon':
      return (
        <p className="flex min-h-nav-target items-center justify-center rounded-sm bg-surface-sunken px-5 font-strong text-ink-muted">
          Coming soon
        </p>
      );
  }
}
