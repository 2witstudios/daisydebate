import {
  reviewFacts,
  wizardHref,
  wizardSummary,
  type Draft,
  type WizardQuery,
} from '../../../features/tournaments/create-wizard';
import { FactList } from '../fact-list/fact-list';
import { DisabledAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { Notice } from '../notice/notice';
import { Basics, Schedule, Size } from './create-steps';
import { Field, card, field, labelClass } from './create-fields';

function Rules({
  query,
  draft,
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
}) {
  const summary = wizardSummary(query);
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Rules and judging</h2>
      <fieldset className="flex flex-col gap-2" disabled>
        <legend className={labelClass}>Rules</legend>
        <label className="flex items-start gap-3 text-base text-ink">
          <input type="radio" name="rules" defaultChecked className="mt-1" />
          <span>Standard rules (same as Ranked)</span>
        </label>
        <label className="flex items-start gap-3 text-base text-ink">
          <input type="radio" name="rules" className="mt-1" />
          <span>Custom rules</span>
        </label>
      </fieldset>
      <Field id="panel" label="Judges per debate">
        <select id="panel" disabled className={field}>
          <option>{draft.panel}</option>
        </select>
      </Field>
      <Notice icon="gavel">{summary.judgesNote}</Notice>
      <Field
        id="mod"
        label="Moderators (optional)"
        note="Can review reports, warn and record forfeits."
      >
        <div className="flex gap-2">
          <input id="mod" disabled placeholder="@handle" className={field} />
          <DisabledAction label="Invite" />
        </div>
      </Field>
    </div>
  );
}

function Review({
  query,
  draft,
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
}) {
  const summary = wizardSummary(query);
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Review and publish</h2>
      <FactList facts={reviewFacts(query, draft)} />
      <Notice icon="gavel">{summary.judgesNote}</Notice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton href={wizardHref({ ...query, step: 'rules' })}>
          Back
        </LinkButton>
        <span className="flex flex-wrap gap-3">
          <DisabledAction label="Save draft" />
          <DisabledAction label="Publish tournament" variant="primary" />
        </span>
      </div>
    </div>
  );
}

export function StepBody({
  query,
  draft,
}: {
  readonly query: WizardQuery;
  readonly draft: Draft;
}) {
  switch (query.step) {
    case 'basics':
      return <Basics draft={draft} />;
    case 'size':
      return <Size query={query} draft={draft} />;
    case 'schedule':
      return <Schedule query={query} draft={draft} />;
    case 'rules':
      return <Rules query={query} draft={draft} />;
    case 'review':
      return <Review query={query} draft={draft} />;
  }
}
