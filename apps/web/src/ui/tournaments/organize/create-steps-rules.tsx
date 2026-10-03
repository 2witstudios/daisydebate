import {
  reviewFacts,
  wizardHref,
  wizardSummary,
  type Draft,
  type WizardQuery,
} from '../../../features/tournaments/create-wizard';
import { FactList } from '../fact-list/fact-list';
import { SampleButton } from '../inert-action/inert-action';
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
      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Rules</legend>
        <label className="flex items-start gap-3 text-base text-ink">
          <input type="radio" name="rules" defaultChecked className="mt-1" />
          <span>
            Standard rules. Exactly the rules of Ranked: seats, speech length
            and prep time. Recommended.
          </span>
        </label>
        <label className="flex items-start gap-3 text-base text-ink">
          <input type="radio" name="rules" className="mt-1" />
          <span>
            Custom rules. Change the seats, speech length or prep time. Shown
            clearly to every entrant.
          </span>
        </label>
      </fieldset>
      <Notice icon="check">
        Unrated. Tournament debates never change ratings. This is fixed and
        cannot be turned on. Ratings come from Ranked play on the Daisy ladder.
      </Notice>
      <Field id="panel" label="Judges per debate">
        <select id="panel" className={field}>
          <option>{draft.panel}</option>
        </select>
      </Field>
      <Notice icon="gavel">
        Judges are assigned by Daisy. You cannot choose judges or rounds. Daisy
        picks from the volunteers who signed up and checks conflicts first: same
        club, recent debates with an entrant, and declared conflicts.{' '}
        {summary.judgesNote}
      </Notice>
      <Field
        id="mod"
        label="Moderators (optional)"
        note="Moderators can review reports, warn and record forfeits. Only you can disqualify or publish."
      >
        <div className="flex gap-2">
          <input id="mod" placeholder="@handle" className={field} />
          <SampleButton label="Invite" />
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
      <Notice icon="gavel">
        Before you publish: {summary.judgesNote} Daisy recruits from the
        volunteer list and tells you if there are too few.
      </Notice>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LinkButton href={wizardHref({ ...query, step: 'rules' })}>
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
