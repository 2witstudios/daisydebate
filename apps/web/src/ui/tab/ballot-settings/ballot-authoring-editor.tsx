'use client';
import { useAnswer } from '../../edge/use-answer';
import { Announcement } from '../../components/announcement/announcement';
import { authoringControlClass as control } from './ballot-authoring-fields';
import { BallotDefinitionSummary } from './ballot-definition-summary';
import { BallotDefinitionFields } from './ballot-definition-fields';
import { useId, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { sampleBallotPreview } from '../../../features/tab/ballot-definition';
import {
  previewDefinition,
  previewStatus,
  readChoice,
  shownSource,
  unchangedChoices,
} from '../../../features/tab/ballot-preview-source';
import { BallotPreview, BallotPreviewLayout } from './ballot-preview';
import {
  useFormResets,
  usePostedValues,
} from '../../form-action/posted-values';
import type { EventBallotAuthoringView } from '@daisy/protocol/lobby/ballot-read';
import { FormField } from '../../components/form-field/form-field';
import {
  BallotCommandForm,
  type BallotAuthoringAction,
} from './ballot-command-form';

const section =
  'flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5';
/** The form an event inside it belongs to, if any. */
const formOf = (event: SyntheticEvent): HTMLFormElement | null =>
  (event.target as Partial<Element>).closest?.('form') ?? null;

/**
 * Whether an event came from one of a form's own buttons (adding or removing
 * a criterion), not its submit button, which disables the form while it posts.
 */
const fromFieldButton = (event: SyntheticEvent): boolean =>
  (event.target as Partial<Element>).closest?.('button[type="button"]') != null;

/**
 * The event's version picker, mounted afresh after each reset of its form:
 * on the posted version while the answer gives it back (refused, or lost and
 * awaiting Retry), so the picker shows what a retry posts; else the saved one.
 */
function PinVersionSelect({
  id,
  saved,
  children,
}: {
  readonly id: string;
  readonly saved: string;
  readonly children: React.ReactNode;
}) {
  const posted = usePostedValues()?.['ballot-version'];
  const anchor = useRef<HTMLSpanElement>(null);
  const resets = useFormResets(anchor);
  return (
    <>
      <span ref={anchor} hidden />
      <select
        key={resets}
        id={id}
        name="ballot-version"
        className={control}
        defaultValue={posted ?? saved}
      >
        {children}
      </select>
    </>
  );
}

/**
 * Host edits the canonical body through explicit business fields; publication
 * and event selection are separate commands. The judge's ballot leads as the
 * main column, drawn from the event's saved definition, and follows the host
 * before anything is saved: the version picked for the event, or the
 * definition the publish form now makes (read by the publish action's own
 * parser). The settings are the column to its right, and follow it on a
 * narrow screen.
 */
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
  const [choices, setChoices] = useState(unchangedChoices);
  // A change can reveal or remove fields (a decision kind's toggles, a score
  // scale, a criterion), which mount only once it renders, and a reset after
  // a post leaves the form only once it has run. So an edit or a reset marks
  // its form, and the form is read after that render commits.
  const edited = useRef<{
    readonly which: 'picked' | 'drafted';
    readonly form: HTMLFormElement;
  } | null>(null);
  const [edits, setEdits] = useState(0);
  const markEdited = (which: 'picked' | 'drafted', event: SyntheticEvent) => {
    const form = formOf(event);
    if (!form) return;
    edited.current = { which, form };
    setEdits((count) => count + 1);
  };
  // Each edit, and each new view after one, reads the form once rendered.
  const reading = useMemo(() => ({ edits, view }), [edits, view]);
  useAnswer(reading, (read) => {
    const mark = edited.current;
    if (read.edits === 0 || !mark) return;
    const values = new FormData(mark.form);
    setChoices((previous) =>
      readChoice(read.view, previous, mark.which, values),
    );
  });
  const source = shownSource(choices);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold">
          Ballot · {view.name}
        </h1>
        <p className="text-ink-muted">
          {view.sourceName === null || view.definition === null
            ? 'This format has no ballot.'
            : `${view.sourceName} · version ${view.definition.ballot.revision}${view.followsTemplate ? ' · pinned by the followed template' : ''}`}
        </p>
      </header>
      {saved === 'publish' ? (
        <Announcement as="p" kind="progress">
          Definition published. The event keeps its current ballot until you
          select another version below.
        </Announcement>
      ) : saved === 'pin' ? (
        <Announcement as="p" kind="progress">
          Event ballot saved.
        </Announcement>
      ) : saved === 'screening' ? (
        <Announcement as="p" kind="progress">
          Screening saved.
        </Announcement>
      ) : null}
      <BallotPreviewLayout
        preview={
          <BallotPreview
            definition={previewDefinition(view, source)}
            preview={sampleBallotPreview}
            status={previewStatus(view, source)}
          />
        }
      >
        {view.definition ? (
          <BallotDefinitionSummary
            definition={view.definition.ballot}
            segments={view.segments}
          />
        ) : null}
        <section
          className={section}
          onChange={(event) => markEdited('picked', event)}
          // A post resets the picker: to the saved version once refused, or
          // to the version a retry would post once unacknowledged.
          onReset={(event) => markEdited('picked', event)}
        >
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
                <PinVersionSelect
                  id={`${id}-pin`}
                  saved={
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
                </PinVersionSelect>
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
          <section
            className={section}
            onChange={(event) => markEdited('drafted', event)}
            onReset={(event) => markEdited('drafted', event)}
            onClick={(event) => {
              // Adding or removing a criterion is a click, not a change.
              if (fromFieldButton(event)) markEdited('drafted', event);
            }}
          >
            <h2 className="font-display text-xl font-bold">
              Publish a definition
            </h2>
            <p className="text-sm text-ink-muted">
              Publishing retains every earlier version. All defaults, criteria
              and guidance below become part of this version.
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
            Screening controls release of submitted words. It does not change
            what the judge is asked to collect.
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
      </BallotPreviewLayout>
    </div>
  );
}
