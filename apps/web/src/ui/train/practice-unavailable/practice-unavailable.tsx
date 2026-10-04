import Link from 'next/link';
import type { UnavailableView } from '../../../features/train/live';
import type { UnavailableLinks } from '../../../features/train/live-links';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { BackLink } from '../back-link/back-link';
import { TurnList } from '../turn-list/turn-list';
import { TrainColumns, TrainPage } from '../train-page/train-page';

const link = 'no-underline hover:no-underline';

/**
 * The AI opponent did not answer. The clock stopped, the speeches are kept,
 * and the practice can retry, carry on solo or end. Reached when the opponent
 * adapter reports unavailable, or from "Report a problem" on the live screen.
 */
export function PracticeUnavailable({
  view,
  links,
}: {
  readonly view: UnavailableView;
  readonly links: UnavailableLinks;
}) {
  return (
    <TrainPage>
      <BackLink href={links.leave}>Leave practice</BackLink>
      <TrainColumns
        asideLabel="Practice guide"
        main={
          <>
            <section
              aria-label="Opponent unavailable"
              className="flex flex-col gap-4 rounded-lg border border-live bg-live-soft p-6 shadow-1"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone="accent">Practice · Unrated</Badge>
                <Badge tone="live">Opponent unavailable</Badge>
              </div>
              <h1 className="font-display text-2xl font-bold text-ink">
                The AI debater did not answer.
              </h1>
              <p className="text-base text-ink-muted">
                {`Stopped during turn ${view.number}. Your speeches are saved and the clock is paused.`}
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={links.tryAgain}
                  className={cn(buttonClass('primary'), link)}
                >
                  Try again
                </Link>
                <Link
                  href={links.continueSolo}
                  className={cn(buttonClass('secondary'), link)}
                >
                  Continue solo
                </Link>
                <Link
                  href={links.end}
                  className={cn(buttonClass('ghost'), link)}
                >
                  End and see debrief
                </Link>
              </div>
            </section>
          </>
        }
        aside={<TurnList rows={view.rows} />}
      />
    </TrainPage>
  );
}
