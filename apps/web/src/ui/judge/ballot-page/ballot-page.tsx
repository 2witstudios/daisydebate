import Link from 'next/link';
import type { BallotView } from '../../../features/judge/ballot';
import { buttonClass } from '../../components/button/button-class';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import type { MockFormAction } from '../../form-action/mock-form';
import { cn } from '../../cn';
import { BallotForm } from './ballot-form';

const linkButton = 'no-underline hover:no-underline';

/** The judge's ballot: not open yet, open to fill in, or submitted. */
export function BallotPage({
  view,
  action,
}: {
  readonly view: BallotView;
  readonly action: MockFormAction;
}) {
  return (
    <div className="mx-auto flex w-full max-w-reading flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <Link
        href="/judge"
        className="inline-flex min-h-10 w-fit items-center gap-2 text-base font-strong text-ink-muted no-underline hover:text-ink hover:no-underline"
      >
        <span aria-hidden="true">&lsaquo;</span>
        Judge
      </Link>
      <PageHeader title="Your ballot" lede={view.title} />
      {view.kind === 'waiting' ? (
        <>
          <Notice
            tone="gold"
            icon="clock"
            title="The ballot opens when the last turn ends"
          />
          <div className="flex flex-wrap gap-3">
            <Link
              href={view.debateHref}
              className={cn(buttonClass('primary'), linkButton)}
            >
              Follow the debate
            </Link>
            <Link
              href={view.demoOpenHref}
              className={cn(buttonClass('ghost'), linkButton)}
            >
              Demo: the speaking ends
            </Link>
          </div>
        </>
      ) : view.kind === 'open' ? (
        <section
          aria-label="Ballot"
          className="rounded-xl bg-surface p-6 shadow-1"
        >
          <BallotForm action={action} />
        </section>
      ) : (
        <>
          <Notice
            tone="accent"
            icon="check"
            title="Ballot submitted"
            role="status"
          >
            It cannot be sent again.
          </Notice>
          <div className="flex flex-wrap gap-3">
            <Link
              href={view.resultHref}
              className={cn(buttonClass('primary'), linkButton)}
            >
              See the result
            </Link>
            <Link
              href={view.hubHref}
              className={cn(buttonClass('secondary'), linkButton)}
            >
              Back to Judge
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
