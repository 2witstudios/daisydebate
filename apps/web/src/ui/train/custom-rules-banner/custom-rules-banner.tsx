import Link from 'next/link';
import { trainDestinations } from '../../../features/train/actions';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { IconChip } from '../icon-chip/icon-chip';

/** The way into custom rules, which are practice only and never rated. */
export function CustomRulesBanner() {
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-5 shadow-1">
      <IconChip name="gavel" />
      <div className="flex min-w-0 flex-1 flex-col">
        <h2 className="text-md font-strong text-ink">
          Practice with custom rules
        </h2>
        <p className="text-sm text-ink-muted">
          Same debate, changed rules: speech length, prep time or seats.
          Practice only, never rated.
        </p>
      </div>
      <Link
        href={trainDestinations.customRules}
        className={cn(
          buttonClass('secondary'),
          'no-underline hover:no-underline',
        )}
      >
        Set custom rules
      </Link>
    </section>
  );
}
