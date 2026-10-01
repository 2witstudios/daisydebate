import Link from 'next/link';
import type { NextUp } from '../../../features/train/hub';
import { trainDestinations } from '../../../features/train/actions';
import { withPlanContext, type HubQuery } from '../../../features/train/query';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';

const link = 'no-underline hover:no-underline';

/**
 * What to do next: the drill for the weakest part, or once the plan is done,
 * an optional extra. The reason is sample logic until real sessions exist.
 */
export function NextCard({
  next,
  query,
}: {
  readonly next: NextUp;
  readonly query: HubQuery;
}) {
  const recommended = next.kind === 'recommended';
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-accent bg-accent-soft p-5 shadow-1">
      <span className="text-xs font-bold tracking-widest text-accent uppercase">
        {recommended ? 'Recommended next' : 'Optional'}
      </span>
      <h3 className="font-display text-xl font-bold text-ink">{next.title}</h3>
      <p className="text-base text-ink-muted">{next.reason}</p>
      {recommended ? (
        <div className="flex items-center gap-2">
          <Badge>Sample</Badge>
          <span className="text-sm text-ink-muted">{`About ${next.minutes} min`}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Link
          href={withPlanContext(next.href, query)}
          className={cn(buttonClass('primary'), link)}
        >
          {recommended ? `Start ${next.title.toLowerCase()}` : 'Start'}
        </Link>
        {recommended ? (
          <Link
            href={withPlanContext(trainDestinations.drill, query)}
            className={cn(buttonClass('secondary'), link)}
          >
            Choose another
          </Link>
        ) : null}
      </div>
    </section>
  );
}
