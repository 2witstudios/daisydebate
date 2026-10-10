'use client';

import {
  roomDraftPreview,
  type RoomDraft,
  type RoomFormControls,
} from '../../features/rooms/room-form';
import { buttonClass } from '../components/button/button-class';
import { FormField } from '../components/form-field/form-field';
import { controlClass } from '../components/form-field/form-field-class';
import { useFormAction, type FormAction } from '../form-action/form-action';

/** Form answer only; saved state is supplied by the caller, never inferred locally. */
export type RoomFormState = {
  readonly draft: RoomDraft;
  readonly saved: RoomDraft;
  readonly phase: 'draft' | 'saved' | 'refused' | 'conflict';
  readonly values: Readonly<Record<string, string>>;
  readonly notice: string | undefined;
};

type FieldsProps = {
  readonly state: RoomFormState;
  readonly controls: Pick<RoomFormControls, 'segments' | 'canEditSequence'>;
  readonly canEdit: boolean;
  readonly pending: boolean;
  readonly post: (form: FormData) => void;
};

const time = (milliseconds: number) => {
  const seconds = (milliseconds % 60000) / 1000;
  return `${Math.floor(milliseconds / 60000)}:${String(seconds).padStart(seconds < 10 ? String(seconds).length + 1 : 2, '0')}`;
};

function Preview({
  draft,
  controls,
  title,
}: {
  readonly draft: RoomDraft;
  readonly controls: Pick<RoomFormControls, 'segments' | 'canEditSequence'>;
  readonly title: string;
}) {
  const preview = roomDraftPreview(draft, controls);
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h3 className="text-md font-strong">{title}</h3>
      <p className="text-sm text-ink-faint">
        {`Affirmative: ${preview.speechCounts.affirmative} ${preview.speechCounts.affirmative === 1 ? 'speech' : 'speeches'} · Negative: ${preview.speechCounts.negative} ${preview.speechCounts.negative === 1 ? 'speech' : 'speeches'}`}
      </p>
      <ol className="flex flex-col gap-2">
        {preview.segments.map((segment) => (
          <li key={segment.key} className="flex justify-between gap-3">
            <span>
              {segment.label}{' '}
              <span className="text-sm text-ink-faint">
                {`(${segment.side === 'affirmative' ? 'Affirmative' : 'Negative'} ${segment.slot + 1})`}
              </span>
            </span>
            <span>{time(segment.durationMs)}</span>
          </li>
        ))}
      </ol>
      <p>Speaking and questions: {time(preview.totalMs)}</p>
    </section>
  );
}

function SegmentFields({
  segment,
  index,
  count,
  canEdit,
  canEditSequence,
  pending,
  values,
  phase,
}: {
  readonly segment: ReturnType<typeof roomDraftPreview>['segments'][number];
  readonly index: number;
  readonly count: number;
  readonly canEdit: boolean;
  readonly canEditSequence: boolean;
  readonly pending: boolean;
  readonly values: RoomFormState['values'];
  readonly phase: RoomFormState['phase'];
}) {
  const blocked = !canEdit || pending;
  return (
    <section className="flex flex-col gap-3 border-b border-border pb-4">
      <input type="hidden" name="segment" value={segment.key} />
      <h3 className="text-md font-strong">
        {index + 1}. {segment.label}
      </h3>
      <FormField
        id={`room-seconds-${segment.key}`}
        label={`${segment.label} length in seconds`}
      >
        <input
          id={`room-seconds-${segment.key}`}
          name={`seconds.${segment.key}`}
          type="text"
          inputMode="decimal"
          defaultValue={
            (canEdit ? values[`seconds.${segment.key}`] : undefined) ??
            String(segment.durationMs / 1000)
          }
          key={`${phase}-${segment.durationMs}`}
          disabled={blocked}
          required
          className={controlClass}
        />
      </FormField>
      {canEdit && canEditSequence ? (
        <div className="flex flex-wrap gap-2">
          {(['earlier', 'later', 'remove'] as const).map((intent) => (
            <button
              key={intent}
              type="submit"
              name="intent"
              value={`${intent}:${segment.key}`}
              disabled={
                pending ||
                (intent === 'earlier' && index === 0) ||
                (intent === 'later' && index === count - 1)
              }
              className={buttonClass('secondary')}
              aria-label={`${intent === 'earlier' ? 'Move up' : intent === 'later' ? 'Move down' : 'Remove'} ${segment.label}`}
            >
              {intent === 'earlier'
                ? 'Move up'
                : intent === 'later'
                  ? 'Move down'
                  : 'Remove'}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FormIntents({
  pending,
  phase,
}: {
  readonly pending: boolean;
  readonly phase: RoomFormState['phase'];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="submit"
        name="intent"
        value="preview"
        disabled={pending}
        className={buttonClass('secondary')}
      >
        Update preview
      </button>
      <button
        type="submit"
        name="intent"
        value="discard"
        disabled={pending}
        className={buttonClass('secondary')}
      >
        Discard draft
      </button>
      {phase === 'conflict' ? (
        <button
          type="submit"
          name="intent"
          value="reread"
          disabled={pending}
          className={buttonClass('secondary')}
        >
          Review latest settings
        </button>
      ) : null}
      <button
        type="submit"
        name="intent"
        value="save"
        disabled={pending || phase === 'conflict'}
        className={buttonClass('primary')}
      >
        {pending ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}

/** Standalone native renderer. The injected action owns preview/edit/save intents. */
export function RoomFormFields({
  state,
  controls,
  canEdit,
  pending,
  post,
}: FieldsProps) {
  const visibleDraft = canEdit ? state.draft : state.saved;
  const preview = roomDraftPreview(visibleDraft, controls);
  return (
    <form
      action={post}
      aria-label="Room speech settings"
      aria-busy={pending}
      className="flex flex-col gap-5"
    >
      <h2 className="text-lg font-strong">Speeches and round order</h2>
      {state.notice ? (
        <p
          role="alert"
          tabIndex={-1}
          id="room-form-notice"
          className="text-sm text-live"
        >
          {state.notice}
        </p>
      ) : null}
      <p className="text-sm text-ink-faint">
        {canEdit
          ? 'Each side has its own speeches. Review the draft before saving.'
          : 'Only the host can change these settings.'}
      </p>
      {preview.segments.map((segment, index) => (
        <SegmentFields
          key={segment.key}
          segment={segment}
          index={index}
          count={preview.segments.length}
          canEdit={canEdit}
          canEditSequence={controls.canEditSequence}
          pending={pending}
          values={state.values}
          phase={state.phase}
        />
      ))}
      {canEdit && controls.canEditSequence ? (
        <div className="flex flex-wrap gap-2">
          {controls.segments
            .filter((segment) => !state.draft.sequence.includes(segment.key))
            .map((segment) => (
              <button
                key={segment.key}
                type="submit"
                name="intent"
                value={`add:${segment.key}`}
                disabled={pending}
                className={buttonClass('secondary')}
              >
                Add {segment.label}
              </button>
            ))}
        </div>
      ) : null}
      <Preview
        draft={visibleDraft}
        controls={controls}
        title={canEdit ? 'Draft preview' : 'Saved settings'}
      />
      {canEdit && state.phase === 'conflict' ? (
        <Preview
          draft={state.saved}
          controls={controls}
          title="Saved settings"
        />
      ) : null}
      {canEdit ? <FormIntents pending={pending} phase={state.phase} /> : null}
    </form>
  );
}

/** Native server action stays intact; hydration adds the existing pending/transport behavior. */
export function RoomForm({
  initial,
  controls,
  canEdit,
  action,
  unavailable,
}: {
  readonly initial: RoomFormState;
  readonly controls: Pick<RoomFormControls, 'segments' | 'canEditSequence'>;
  readonly canEdit: boolean;
  readonly action: FormAction<RoomFormState>;
  readonly unavailable: (form: FormData) => RoomFormState;
}) {
  const [state, post, pending] = useFormAction(action, initial, unavailable);
  return (
    <RoomFormFields
      state={state}
      controls={controls}
      canEdit={canEdit}
      pending={pending}
      post={post}
    />
  );
}
