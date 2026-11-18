import type { FormAction } from '../form-action/form-action';
import { PageHeader } from '../components/page-header/page-header';
import type { RequestFormState } from '../../features/league-requests/request-form';
import { LeagueRequestForm } from './league-request-form';

const nextSteps = [
  'We reply within two working days.',
  'A call to plan seasons, schools, divisions and rules.',
  'We set up the league with you and bring your schools in.',
];

/**
 * /contact/league: League's "Talk to us" (decision 80). The form beside
 * what happens after it is sent; a phone stacks them.
 */
export function LeagueRequestPage({
  requestId,
  action,
}: {
  readonly requestId: string;
  readonly action: FormAction<RequestFormState>;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="Talk to us about a league"
        lede="Tell us about your league and we'll set it up with you."
      />
      <div className="flex flex-wrap items-start gap-6">
        <LeagueRequestForm requestId={requestId} action={action} />
        <aside
          aria-labelledby="league-request-next"
          className="flex min-w-0 flex-1 basis-league-request-aside flex-col gap-3 rounded-xl bg-surface-overlay p-6"
        >
          <h2
            id="league-request-next"
            className="font-display text-lg font-bold"
          >
            What happens next
          </h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-sm text-ink-muted">
            League pricing depends on schools and seasons. Every tournament the
            league runs is covered, with recording, AI judging and broadcast.
          </p>
        </aside>
      </div>
    </div>
  );
}
