'use client';
import { useId } from 'react';
import type { BallotWrittenRecord } from '@daisy/protocol/ballot-schema';
import {
  CompletionCommandForm,
  type CompletionAction,
} from '../completion/completion-command-form';
import { FormField } from '../../components/form-field/form-field';

/** A host chooses the audience copy; the submitted ballot stays available above it. */
export function ScreeningEditor({
  written,
  action,
}: {
  readonly written: BallotWrittenRecord;
  readonly action: CompletionAction;
}) {
  const id = useId(),
    control =
      'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';
  return (
    <CompletionCommandForm
      action={action}
      label="Resolve written feedback screening"
      submitLabel="Approve reviewed text"
    >
      <p className="text-sm text-ink-muted">
        Publish the submitted text as it stands, or edit the audience copy
        first.
      </p>
      <FormField id={`${id}-mode`} label="Audience copy">
        <select
          id={`${id}-mode`}
          name="mode"
          defaultValue="redacted"
          className={control}
        >
          <option value="redacted">Publish edited text</option>
          <option value="original">Publish submitted text</option>
        </select>
      </FormField>
      {written.reason === undefined ? null : (
        <FormField id={`${id}-reason`} label="Edited reason">
          <textarea
            id={`${id}-reason`}
            name="reason"
            defaultValue={written.reason}
            rows={5}
            className={control}
          />
        </FormField>
      )}
      {Object.entries(written.feedback ?? {}).map(([key, text], index) => (
        <FormField
          key={key}
          id={`${id}-feedback-${index}`}
          label={`Edited feedback ${index + 1}`}
        >
          <textarea
            id={`${id}-feedback-${index}`}
            name={`feedback:${key}`}
            defaultValue={text}
            rows={3}
            className={control}
          />
        </FormField>
      ))}
    </CompletionCommandForm>
  );
}
