import Link from 'next/link';
import { judgeRoutes } from '../../../features/judge/routes';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';

/**
 * The hub's one action. Matchmaking is a button, never a list: the system
 * assigns the debate, so this only asks to join the judge pool. Judging has
 * its own hue (ADR 0051): a solid disc and a faint wash, with the usual
 * green primary button.
 */
export function StartJudging() {
  return (
    <section
      aria-label="Start judging"
      className="flex items-center gap-6 rounded-xl border border-border bg-hue-plum-soft p-8 shadow-1 max-compact:flex-col max-compact:items-start max-compact:p-5"
    >
      <span className="flex size-16 shrink-0 items-center justify-center rounded-round bg-hue-plum text-background">
        <Icon name="gavel" size={28} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="font-display text-2xl leading-tight font-bold text-ink">
          Ready to judge?
        </h2>
      </div>
      <Link
        href={judgeRoutes.waiting}
        className={cn(
          buttonClass('primary'),
          'px-8 py-4 text-lg font-bold whitespace-nowrap no-underline hover:no-underline max-compact:w-full',
        )}
      >
        Start judging
      </Link>
    </section>
  );
}
