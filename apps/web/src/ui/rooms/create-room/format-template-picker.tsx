'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';

const subscribeNever = () => () => undefined;

function selectionValue(choice: RoomTemplate) {
  return JSON.stringify({
    kind: 'catalog',
    formatId: choice.formatId,
    formatVersion: choice.formatVersion,
    length: 'full',
    competitionType: 'casual',
    config: choice.defaultConfig,
  });
}

function TemplateSchedule({ choice }: { readonly choice: RoomTemplate }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        {choice.definition.seats.affirmative} aff /{' '}
        {choice.definition.seats.negative} neg
        {' · '}
        {choice.definition.seats.judge} judge
      </p>
      <ol
        aria-label={`${choice.label} speech order`}
        className="flex flex-col gap-2"
      >
        {choice.definition.segments.map((segment) => (
          <li key={segment.key} className="flex justify-between gap-4 text-sm">
            <span>{segment.label}</span>
            <span className="shrink-0 text-ink-muted tabular-nums">
              {(choice.defaultConfig.speechTiming.segmentDurationOverrides[
                segment.key
              ] ?? segment.defaultDurationMs) / 1000}{' '}
              s
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Local browsing enhances the canonical select; the native POST remains authoritative. */
export function FormatTemplatePicker({
  choices,
  defaultValue,
}: {
  readonly choices: readonly RoomTemplate[];
  readonly defaultValue?: string | undefined;
}) {
  const initial =
    defaultValue ?? (choices[0] ? selectionValue(choices[0]) : '');
  const [value, setValue] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const interactive = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const selected = choices.find((choice) => selectionValue(choice) === value);
  const preview = choices.find((choice) => selectionValue(choice) === draft);
  return (
    <div className="flex flex-col gap-3">
      <FormField id="assembly-format" label="Format template">
        <select
          id="assembly-format"
          name="selection"
          required
          value={selected ? value : ''}
          onChange={(event) => setValue(event.target.value)}
          className={controlClass}
        >
          {!selected ? (
            <option value="">Choose an available format</option>
          ) : null}
          {choices.map((choice) => (
            <option
              key={`${choice.formatId}:${choice.formatVersion}`}
              value={selectionValue(choice)}
            >
              {choice.label} · {choice.definition.seats.affirmative} aff /{' '}
              {choice.definition.seats.negative} neg
            </option>
          ))}
        </select>
      </FormField>
      {selected ? (
        <div hidden={!interactive} aria-label="Selected format preview">
          <TemplateSchedule choice={selected} />
        </div>
      ) : null}
      {choices.length > 0 ? (
        <>
          <button
            type="button"
            hidden={!interactive}
            className={buttonClass('secondary')}
            onClick={() => {
              setDraft(value);
              dialog.current?.showModal();
            }}
          >
            Browse formats
          </button>
          <dialog
            ref={dialog}
            aria-labelledby={titleId}
            className="m-auto max-h-full w-full max-w-dash-column overflow-y-auto rounded-xl border border-border bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim max-compact:rounded-none"
          >
            <header className="mb-6 flex items-center justify-between gap-4">
              <h2 id={titleId} className="font-display text-xl font-bold">
                Choose a format
              </h2>
              <button
                type="button"
                className={buttonClass('secondary')}
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
            </header>
            <div className="grid grid-cols-2 gap-6 max-compact:grid-cols-1">
              <div
                aria-label="Available formats"
                className="flex max-h-full flex-col gap-2 overflow-auto"
              >
                {choices.map((choice) => (
                  <button
                    type="button"
                    key={`${choice.formatId}:${choice.formatVersion}`}
                    aria-pressed={draft === selectionValue(choice)}
                    className="rounded-lg border border-border p-3 text-left hover:bg-surface-raised aria-pressed:border-accent aria-pressed:bg-surface-raised"
                    onClick={() => setDraft(selectionValue(choice))}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              {preview ? (
                <section
                  aria-label="Format preview"
                  className="flex flex-col gap-4"
                >
                  <h3 className="font-display text-lg font-bold">
                    {preview.label}
                  </h3>
                  <TemplateSchedule choice={preview} />
                  <button
                    type="button"
                    className={buttonClass('primary')}
                    onClick={() => {
                      setValue(draft);
                      dialog.current?.close();
                    }}
                  >
                    Use this format
                  </button>
                </section>
              ) : null}
            </div>
          </dialog>
        </>
      ) : null}
    </div>
  );
}
