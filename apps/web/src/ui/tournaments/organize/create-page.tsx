import {
  editPairs,
  wizardMarks,
  type Draft,
  type DraftEdits,
  type WizardQuery,
} from '../../../features/tournaments/create-wizard';
import { tournamentRoutes } from '../../../features/tournaments/routes';

import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { buttonClass } from '../../components/button/button-class';
import { LinkButton } from '../link-button/link-button';

import { StepBody } from './create-steps-rules';
import { PageHeader } from '../../components/page-header/page-header';
import { PageFrame } from '../page-frame/page-frame';
import { cn } from '../../cn';
import Link from 'next/link';

const order = ['basics', 'size', 'schedule', 'rules', 'review'] as const;

/** The five-step wizard: steps are links, choices live in the URL. */
export function CreatePage({
  query,
  draft,
  edits,
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
  /** What the organizer has typed so far, carried in the address. */
  readonly edits: DraftEdits;
}) {
  const marks = wizardMarks(query, edits);
  const at = order.indexOf(query.step);
  const before = order[at - 1];
  const after = order[at + 1];
  return (
    <PageFrame>
      <Breadcrumb
        trail={[
          { label: 'Organize', href: tournamentRoutes.organize },
          { label: 'New tournament' },
        ]}
      />
      <PageHeader title="Create a tournament" />
      <div className="flex items-start gap-6 max-rail:flex-col">
        <nav
          aria-label="Steps"
          className="flex w-rail shrink-0 flex-col gap-2 rounded-xl bg-surface p-4 shadow-1 max-rail:w-full"
        >
          <ol className="flex flex-col gap-1">
            {marks.map((mark, index) => (
              <li key={mark.step}>
                <Link
                  href={mark.href}
                  aria-current={mark.state === 'current' ? 'step' : undefined}
                  className={cn(
                    'flex min-h-10 items-center gap-3 rounded-sm px-2 text-base no-underline hover:no-underline',
                    mark.state === 'current'
                      ? 'bg-accent-soft font-strong text-accent'
                      : 'text-ink-muted',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded-round border text-xs font-bold',
                      mark.state === 'done' &&
                        'border-accent bg-accent text-accent-ink',
                      mark.state === 'current' && 'border-accent text-accent',
                      mark.state === 'todo' &&
                        'border-border-strong text-ink-faint',
                    )}
                  >
                    {mark.state === 'done' ? '✓' : index + 1}
                  </span>
                  {mark.label}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <form
          action={tournamentRoutes.create}
          method="get"
          className="flex min-w-0 flex-1 flex-col gap-4 max-rail:w-full"
        >
          <input type="hidden" name="structure" value={query.structure} />
          <input type="hidden" name="places" value={query.places} />
          {editPairs(edits, query.step).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <StepBody query={query} draft={draft} edits={edits} />
          {query.step === 'review' ? null : (
            <div className="flex justify-between gap-3">
              {before ? (
                <button
                  type="submit"
                  name="step"
                  value={before}
                  className={buttonClass('secondary')}
                >
                  Back
                </button>
              ) : (
                <LinkButton href={tournamentRoutes.organize}>Cancel</LinkButton>
              )}
              {after ? (
                <button
                  type="submit"
                  name="step"
                  value={after}
                  className={buttonClass('primary')}
                >
                  Continue
                </button>
              ) : null}
            </div>
          )}
        </form>
      </div>
    </PageFrame>
  );
}
