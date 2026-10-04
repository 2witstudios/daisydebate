import {
  reviewFacts,
  wizardHref,
  wizardSummary,
} from '../../../features/tournaments/create-wizard';
import { FactList } from '../fact-list/fact-list';
import { SampleButton } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { Notice } from '../notice/notice';
import { Basics, Schedule, Size } from './create-steps';
import {
  Field,
  card,
  field,
  labelClass,
  type StepProps,
} from './create-fields';

function Rules({ query, draft, edits }: StepProps) {
  const summary = wizardSummary(query);
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Rules and judging</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Rules</legend>
        <label className="flex items-start gap-3 text-base text-ink">
          <input
            type="radio"
            name="rules"
            value="standard"
            defaultChecked={draft.rules === 'standard'}
            className="mt-1"
          />
          <span>Standard rules (same as Ranked)</span>
        </label>
        <label className="flex items-start gap-3 text-base text-ink">
          <input
            type="radio"
            name="rules"
            value="custom"
            defaultChecked={draft.rules === 'custom'}
            className="mt-1"
          />
          <span>Custom rules</span>
        </label>
      </fieldset>

      <Field id="panel" label="Judges per debate">
        <select id="panel" className={field}>
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
          <input
            id="mod"
            name="mod"
            defaultValue={edits['mod']}
            placeholder="@handle"
            className={field}
          />
          <SampleButton label="Invite" />
        </div>
      </Field>
    </div>
  );
}

function Review({ query, draft, edits }: StepProps) {
  const summary = wizardSummary(query);
  return (
    <div className={card}>
      <h2 className="text-lg font-strong text-ink">Review and publish</h2>
      <FactList facts={reviewFacts(query, draft)} />
      <Notice icon="gavel">{summary.judgesNote}</Notice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton href={wizardHref({ ...query, step: 'rules' }, edits)}>
          Back
        </LinkButton>
        <span className="flex flex-wrap gap-3">
          <SampleButton label="Save draft" />
          <SampleButton label="Publish tournament" variant="primary" />
        </span>
      </div>
    </div>
  );
}

export function StepBody({ query, draft, edits }: StepProps) {
  switch (query.step) {
    case 'basics':
      return <Basics draft={draft} />;
    case 'size':
      return <Size query={query} draft={draft} edits={edits} />;
    case 'schedule':
      return <Schedule query={query} draft={draft} edits={edits} />;
    case 'rules':
      return <Rules query={query} draft={draft} edits={edits} />;
    case 'review':
      return <Review query={query} draft={draft} edits={edits} />;
  }
}
