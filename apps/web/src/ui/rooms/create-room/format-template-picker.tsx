'use client';

import { Dialog } from '../../components/dialog/dialog';
import { Button } from '../../components/button/button';
import { useId, useState, useSyncExternalStore } from 'react';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { clockDuration } from '../../../features/rooms/duration-input';
import {
  formatFamilyLabel,
  speechName,
} from '../../../features/debate-room/vocabulary';
import {
  browserListing,
  browserTabs,
  casualSelection,
  catalogGroups,
  choiceSummary,
  defaultChoice,
  presetSpeechMs,
} from '../../../features/rooms/format-browser';

const subscribeNever = () => () => undefined;

const selectionValue = (choice: RoomTemplate) =>
  JSON.stringify(casualSelection(choice));

/** "Freestyle (1v1) · about 45 min · resolution by strike", from the template's own config. */
function templateLine(choice: RoomTemplate) {
  const [shape, ...rest] = choiceSummary(choice).split(' · ');
  return `${choice.label} (${shape}) · ${rest.join(' · ')}`;
}

function TemplateSchedule({ choice }: { readonly choice: RoomTemplate }) {
  const durations = presetSpeechMs(choice);
  const judges = choice.definition.seats.judges;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        {templateLine(choice)} · {judges === 1 ? '1 judge' : `${judges} judges`}
      </p>
      <ol
        aria-label={`${choice.label} speech order`}
        className="flex flex-col gap-2"
      >
        {choice.definition.segments.map((segment, index) => (
          <li key={segment.key} className="flex justify-between gap-4 text-sm">
            <span>{speechName(segment)}</span>
            <span className="shrink-0 text-ink-muted tabular-nums">
              {clockDuration(durations[index]!)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Browse dialog: search, family tabs and a preview; choosing sets the native select. */
function FormatBrowserDialog({
  choices,
  serialize,
  open,
  onClose,
  draft,
  setDraft,
  onUse,
}: {
  readonly choices: readonly RoomTemplate[];
  readonly serialize: (choice: RoomTemplate) => string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly draft: string;
  readonly setDraft: (value: string) => void;
  readonly onUse: () => void;
}) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const tabs = browserTabs(choices, formatFamilyLabel);
  const [tab, setTab] = useState(tabs[0]?.key ?? 'standard');
  const listed = browserListing(choices, { query, tab });
  const preview = choices.find((choice) => serialize(choice) === draft);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto max-h-full w-full max-w-dash-column overflow-y-auto rounded-xl border border-border bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim max-compact:rounded-none"
    >
      <header className="mb-6 flex items-center justify-between gap-4">
        <h2 id={titleId} className="font-display text-xl font-bold">
          Choose a format
        </h2>
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-6 max-compact:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-3">
          <input
            type="search"
            aria-label="Search formats and leagues"
            placeholder="Search: LD, NSDA, policy, NCFCA…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={controlClass}
          />
          {query ? null : (
            <div
              role="group"
              aria-label="Format families"
              className="flex flex-wrap gap-1"
            >
              {tabs.map((option) => (
                <Button
                  variant="chip"
                  type="button"
                  key={option.key}
                  aria-pressed={option.key === tab}
                  onClick={() => setTab(option.key)}
                  size="room"
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
          <div
            aria-label="Available formats"
            className="flex max-h-full flex-col gap-2 overflow-auto"
          >
            {listed.map((choice) => (
              <Button
                variant="option-card"
                type="button"
                key={`${choice.formatId}:${choice.formatVersion}`}
                aria-pressed={draft === serialize(choice)}
                onClick={() => setDraft(serialize(choice))}
              >
                <span className="block">{choice.label}</span>
                <span className="block text-xs text-ink-muted">
                  {choice.leagues.join(', ')}
                </span>
              </Button>
            ))}
            {listed.length ? null : (
              <p className="text-sm text-ink-muted">
                No format matches. Try a league (NSDA, NCFCA) or an event
                (policy, LD).
              </p>
            )}
          </div>
        </div>
        {preview ? (
          <section aria-label="Format preview" className="flex flex-col gap-4">
            <h3 className="font-display text-lg font-bold">{preview.label}</h3>
            <TemplateSchedule choice={preview} />
            <p className="text-xs text-ink-muted">
              {preview.rulesEdition ? `Rules: ${preview.rulesEdition}` : null}
            </p>
            <Button variant="primary" type="button" onClick={onUse}>
              Use this format
            </Button>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}

type PickerField = {
  readonly name: string;
  readonly label: string;
  readonly id: string;
};
const createField: PickerField = {
  name: 'selection',
  label: 'Format',
  id: 'assembly-format',
};

/** Local browsing enhances the canonical select; the native POST remains authoritative. */
export function FormatTemplatePicker({
  choices,
  defaultValue,
  field = createField,
  serialize = selectionValue,
}: {
  readonly choices: readonly RoomTemplate[];
  readonly defaultValue?: string | undefined;
  /** The native field: create's `selection`, or Room setup's `format` tuple. */
  readonly field?: PickerField;
  readonly serialize?: (choice: RoomTemplate) => string;
}) {
  const { name, label, id: fieldId } = field;
  const first = defaultChoice(choices);
  const initial = defaultValue ?? (first ? serialize(first) : '');
  const [value, setValue] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const interactive = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [browsing, setBrowsing] = useState(false);
  const selected = choices.find((choice) => serialize(choice) === value);
  return (
    <div className="flex flex-col gap-3">
      <FormField id={fieldId} label={label}>
        <select
          id={fieldId}
          name={name}
          required
          value={selected ? value : ''}
          onChange={(event) => setValue(event.target.value)}
          className={controlClass}
        >
          {selected ? null : (
            <option value="">Choose an available format</option>
          )}
          {catalogGroups(choices, formatFamilyLabel).map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map((choice) => (
                <option
                  key={`${choice.formatId}:${choice.formatVersion}`}
                  value={serialize(choice)}
                >
                  {templateLine(choice)}
                </option>
              ))}
            </optgroup>
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
          <Button
            variant="secondary"
            type="button"
            hidden={!interactive}
            onClick={() => {
              setDraft(value);
              setBrowsing(true);
            }}
          >
            Browse formats
          </Button>
          <FormatBrowserDialog
            choices={choices}
            serialize={serialize}
            open={browsing}
            onClose={() => setBrowsing(false)}
            draft={draft}
            setDraft={setDraft}
            onUse={() => {
              setValue(draft);
              setBrowsing(false);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
