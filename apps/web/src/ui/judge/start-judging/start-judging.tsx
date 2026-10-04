import Link from 'next/link';
import { judgeRoutes } from '../../../features/judge/routes';

/**
 * The hub's one action. Matchmaking is a button, never a list: the system
 * assigns the debate, so this only asks to join the judge pool.
 */
export function StartJudging() {
  return (
    <section
      aria-label="Start judging"
      className="flex flex-col gap-5 rounded-xl bg-surface-stage p-10 shadow-1 max-compact:p-5"
    >
      <h2 className="font-display text-3xl leading-tight font-bold text-stage-ink max-compact:text-2xl">
        Ready to judge?
      </h2>
      <div className="flex flex-col items-start gap-2 max-compact:items-stretch">
        <Link
          href={judgeRoutes.waiting}
          className="inline-flex items-center justify-center rounded-md bg-stage-accent px-8 py-4 text-lg font-bold whitespace-nowrap text-stage-accent-ink no-underline hover:bg-stage-accent-strong hover:no-underline"
        >
          Start judging
        </Link>
      </div>
    </section>
  );
}
