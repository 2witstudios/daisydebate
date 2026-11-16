'use client';
import { authoringControlClass as control } from './ballot-authoring-fields';
import { BallotDefinitionSummary } from './ballot-definition-summary';
import { BallotDefinitionFields } from './ballot-definition-fields';
import { useId } from 'react';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { FormField } from '../../components/form-field/form-field';
import {
  BallotCommandForm,
  type BallotAuthoringAction,
} from './ballot-command-form';

const section =
  'flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5';
/** Host edits the canonical body through explicit business fields; publication and event selection are separate commands. */
export function BallotAuthoringEditor({
  view,
  publish,
  pin,
  screening,
  saved,
}: {
  readonly view: EventBallotAuthoringView;
  readonly publish: BallotAuthoringAction;
  readonly pin: BallotAuthoringAction;
  readonly screening: BallotAuthoringAction;
  readonly saved: string | null;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold">
          Ballot · {view.name}
        </h1>
        <p className="text-ink-muted">
          {view.sourceName === null
            ? 'This format has no ballot.'
            : `${view.sourceName} · version ${view.definition!.ballot.revision}${view.followsTemplate ? ' · pinned by the followed template' : ''}`}
        </p>
      </header>
      {saved === 'publish' ? (
        <p role="status">
          Definition published. The event keeps its current ballot until you
          select another version below.
        </p>
      ) : saved === 'pin' ? (
        <p role="status">Event ballot saved.</p>
      ) : saved === 'screening' ? (
        <p role="status">Screening saved.</p>
      ) : null}
      {view.definition ? (
        <BallotDefinitionSummary
          definition={view.definition.ballot}
          segments={view.segments}
        />
      ) : null}
      <section className={section}>
        <h2 className="font-display text-xl font-bold">
          Ballot for this event
        </h2>
        {view.capabilities.pin ? (
          <BallotCommandForm
            action={pin}
            label="Select event ballot"
            submitLabel="Use this ballot"
          >
            <FormField id={`${id}-pin`} label="Immutable version">
              <select
                id={`${id}-pin`}
                name="ballot-version"
                className={control}
                defaultValue={
                  view.definition?.source.kind === 'stored'
                    ? `${view.definition.source.id}@${view.definition.source.version}`
                    : 'daisy'
                }
              >
                <option value="daisy">Daisy ballot for this format</option>
                {view.definitions.flatMap((definition) =>
                  definition.versions.map((version) => (
                    <option
                      key={`${definition.id}@${version.version}`}
                      value={`${definition.id}@${version.version}`}
                      disabled={!version.compatible}
                    >
                      {definition.name} · version {version.version}
                      {version.compatible
                        ? ''
                        : ' · incompatible with this format'}
                    </option>
                  )),
                )}
              </select>
            </FormField>
          </BallotCommandForm>
        ) : (
          <p className="text-sm text-ink-muted">
            {view.followsTemplate
              ? 'The followed template pins this ballot.'
              : view.entriesExist
                ? 'Entries already use this event, so its ballot cannot change.'
                : 'You can read this ballot. Changing it is unavailable.'}
          </p>
        )}
      </section>
      {view.capabilities.publish ? (
        <section className={section}>
          <h2 className="font-display text-xl font-bold">
            Publish a definition
          </h2>
          <p className="text-sm text-ink-muted">
            Publishing retains every earlier version. All defaults, criteria and
            guidance below become part of this version.
          </p>
          <BallotCommandForm
            action={publish}
            label="Publish ballot definition"
            submitLabel="Publish definition"
          >
            <BallotDefinitionFields view={view} />
          </BallotCommandForm>
        </section>
      ) : null}
      <section className={section}>
        <h2 className="font-display text-xl font-bold">
          Written text screening
        </h2>
        <p className="text-sm text-ink-muted">
          Screening controls release of submitted words. It does not change what
          the judge is asked to collect.
        </p>
        {view.capabilities.setScreening ? (
          <BallotCommandForm
            action={screening}
            label="Ballot screening"
            submitLabel="Save screening"
          >
            <FormField id={`${id}-screening`} label="Screening">
              <select
                id={`${id}-screening`}
                name="screening"
                defaultValue={view.screening}
                className={control}
              >
                <option value="hold">Hold flagged text for review</option>
                <option value="off">Release unscreened text</option>
              </select>
            </FormField>
          </BallotCommandForm>
        ) : (
          <p>
            {view.screening === 'hold'
              ? 'Flagged text is held for review.'
              : 'Text is released unscreened.'}
          </p>
        )}
      </section>
    </div>
  );
}
