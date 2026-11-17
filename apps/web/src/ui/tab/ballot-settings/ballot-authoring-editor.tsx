'use client';
import { authoringControlClass as control } from './ballot-authoring-fields';
import { BallotDefinitionSummary } from './ballot-definition-summary';
import { BallotDefinitionFields } from './ballot-definition-fields';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import { sampleBallotPreview } from '../../../features/tab/ballot-definition';
import {
  draftedPreview,
  pickedPreview,
  previewDefinition,
  previewStatus,
  savedPreview,
} from '../../../features/tab/ballot-preview-source';
import { BallotPreview, BallotPreviewLayout } from './ballot-preview';
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
  const [source, setSource] = useState(savedPreview);
  // A change can reveal or remove fields (a decision kind's toggles, a score
  // scale, a criterion), which mount only once it renders. So an edit, or a
  // reset after a refused publish, marks the form, and the form is read after
  // that render commits.
  const edited = useRef<HTMLFormElement | null>(null);
  const [edits, setEdits] = useState(0);
  const markEdited = (form: HTMLFormElement | null) => {
    if (!form) return;
    edited.current = form;
    setEdits((count) => count + 1);
  };
  useLayoutEffect(() => {
    const form = edited.current;
    if (edits === 0 || !form) return;
    const values = new FormData(form);
    setSource((previous) => draftedPreview(view, values, previous));
  }, [edits, view]);
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
          // A refused pin resets the picker to the saved version.
          onReset={() =>
            setSource((previous) =>
              previous.kind === 'version' || previous.kind === 'daisy-unshown'
                ? savedPreview
                : previous,
            )
          }
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
                <select
                  id={`${id}-pin`}
                  name="ballot-version"
                  onChange={(event) =>
                    setSource(pickedPreview(view, event.target.value))
                  }
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
          <section
            className={section}
            onChange={(event) => markEdited(formOf(event))}
            onReset={(event) => markEdited(formOf(event))}
            onClick={(event) => {
              // Adding or removing a criterion is a click, not a change.
              if (fromFieldButton(event)) markEdited(formOf(event));
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
