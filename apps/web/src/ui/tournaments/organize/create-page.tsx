import {
  wizardHref,
  wizardMarks,
  type Draft,
  type WizardQuery,
} from '../../../features/tournaments/create-wizard';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
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
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
}) {
  const marks = wizardMarks(query);
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
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-rail:w-full">
          <StepBody query={query} draft={draft} />
          {query.step === 'review' ? null : (
            <div className="flex justify-between gap-3">
              {before ? (
                <LinkButton href={wizardHref({ ...query, step: before })}>
                  Back
                </LinkButton>
              ) : (
                <LinkButton href={tournamentRoutes.organize}>Cancel</LinkButton>
              )}
              {after ? (
                <LinkButton
                  href={wizardHref({ ...query, step: after })}
                  variant="primary"
                >
                  Continue
                </LinkButton>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
