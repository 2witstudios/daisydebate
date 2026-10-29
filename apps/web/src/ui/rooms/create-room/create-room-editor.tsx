'use client';

import { useState } from 'react';
import type { PublishedResolution, RoomCatalogChoice } from '@daisy/protocol';
import { createRoomDraft } from '../../../features/rooms/create-room-draft';
import {
  draftFormValues,
  readRoomDraft,
  roomChoiceKey,
} from '../../../features/rooms/create-room-fields';
import { changeDraftSchedule } from '../../../features/rooms/prepare-room-draft';
import { controlClass } from '../../components/form-field/form-field-class';
import { buttonClass } from '../../components/button/button-class';
import { FormError } from '../../components/form-field/form-field';
import { DraftSettings } from './draft-settings';
import { DraftPreview } from './draft-preview';

const formats = [
  ['freestyle', 'Freestyle', 'Strike & prepare'],
  ['policy', 'Policy', 'Policy res'],
  ['value', 'Value', 'Value res'],
  ['custom', 'Custom', 'Your rules'],
] as const;

export function CreateRoomEditor({
  choices,
  resolutions,
  initialChoice,
  values: kept,
  commandId,
  initialRated,
  pending,
  error,
}: {
  readonly choices: readonly RoomCatalogChoice[];
  readonly resolutions: readonly PublishedResolution[];
  readonly initialChoice: RoomCatalogChoice;
  readonly values: Readonly<Record<string, string>>;
  readonly commandId: string;
  readonly initialRated: boolean;
  readonly pending: boolean;
  readonly error?: string | undefined;
}) {
  const [model, setModel] = useState(() => {
    const defaults = createRoomDraft(initialChoice);
    const values: Record<string, string> = {
      ...draftFormValues(defaults),
      title: '',
      visibility: 'unlisted',
      ...kept,
    };
    if (
      initialRated &&
      Object.keys(kept).length === 0 &&
      initialChoice.preset.rankedEligible
    )
      values.ranked = 'on';
    const parsed = readRoomDraft(values, choices);
    return {
      values: values as Readonly<Record<string, string>>,
      draft: parsed.ok ? parsed.draft : defaults,
    };
  });
  const [query, setQuery] = useState('');
  const { values, draft } = model;
  const isCustom = values.format === 'custom' || draft.custom;
  const publication = resolutions.find(
    (resolution) => resolution.kind === values.resolutionMethod,
  );
  const missingPublication =
    (values.resolutionMethod === 'policy' ||
      values.resolutionMethod === 'value') &&
    !publication;
  const change = (name: string, value: string) =>
    setModel((current) => {
      const next = {
        ...current.values,
        [name]: value,
        format: 'custom',
        ranked: '',
      };
      const read = readRoomDraft(next, choices);
      return {
        values: next,
        draft: read.ok
          ? read.draft
          : { ...current.draft, custom: true, ranked: false },
      };
    });
  const metadata = (name: string, value: string) =>
    setModel((current) => ({
      ...current,
      values: { ...current.values, [name]: value },
    }));
  const choose = (choice: RoomCatalogChoice) =>
    setModel((current) => {
      const selected = createRoomDraft(choice);
      return {
        values: { ...current.values, ...draftFormValues(selected) },
        draft: selected,
      };
    });
  const schedule = (intent: string) =>
    setModel((current) => {
      const read = readRoomDraft(current.values, choices);
      if (!read.ok) return current;
      const edited = changeDraftSchedule(read.draft, intent);
      return {
        values: { ...current.values, ...draftFormValues(edited) },
        draft: edited,
      };
    });
  const templates = choices.filter(
    (choice) =>
      choice.role === 'template' &&
      `${choice.label} ${choice.leagues.join(' ')} ${choice.searchTerms}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <div className="create-room-layout">
      <fieldset disabled={pending} className="create-room-card">
        <input
          type="hidden"
          name="commandId"
          value={kept.commandId ?? commandId}
        />
        <input type="hidden" name="basis" value={values.basis} />
        <div className="create-room-section">
          <label className="create-room-field" htmlFor="assembly-title">
            <span>Room name</span>
            <input
              id="assembly-title"
              name="title"
              className={controlClass}
              value={values.title ?? ''}
              onChange={(event) => metadata('title', event.target.value)}
              placeholder="Thursday evening debates"
              required
              maxLength={120}
            />
          </label>
        </div>
        <div id="create-room-answer" tabIndex={-1}>
          <FormError error={error} />
        </div>
        <section
          className="create-room-section"
          aria-labelledby="create-format-title"
        >
          <h2 id="create-format-title">Format</h2>
          <div
            className="create-room-formats"
            role="radiogroup"
            aria-labelledby="create-format-title"
          >
            {formats.map(([id, label, caption]) => (
              <label key={id} className="create-room-format">
                <input
                  type="radio"
                  name="format"
                  value={id}
                  checked={values.format === id}
                  disabled={
                    id !== 'custom' &&
                    !choices.some(
                      (choice) =>
                        choice.role === 'standard' && choice.formatId === id,
                    )
                  }
                  onChange={() => {
                    if (id === 'custom') change('format', 'custom');
                    else {
                      const choice = choices.find(
                        (item) =>
                          item.role === 'standard' && item.formatId === id,
                      );
                      if (choice) choose(choice);
                    }
                  }}
                />
                <strong>{label}</strong>
                <span>{caption}</span>
              </label>
            ))}
          </div>
          <noscript>
            <button
              type="submit"
              name="intent"
              value="configure"
              formNoValidate
              className={buttonClass('secondary')}
            >
              Apply format
            </button>
          </noscript>
          <div className="create-room-ranked">
            <label>
              <input
                type="checkbox"
                name="ranked"
                value="on"
                checked={values.ranked === 'on' && !isCustom}
                disabled={
                  isCustom ||
                  !draft.basis.preset.rankedEligible ||
                  missingPublication
                }
                onChange={(event) => {
                  const ranked = event.target.checked;
                  setModel((current) => ({
                    values: { ...current.values, ranked: ranked ? 'on' : '' },
                    draft: { ...current.draft, ranked },
                  }));
                }}
              />
              Ranked
            </label>
            <span>
              {isCustom
                ? 'Standard settings required'
                : draft.basis.preset.rankedEligible
                  ? `${draft.basis.label} ladder`
                  : 'Ranked unavailable'}
            </span>
          </div>
          {isCustom ? (
            <details className="create-room-library">
              <summary>Start from a league template</summary>
              <label className="create-room-field">
                <span>Search formats and leagues</span>
                <input
                  type="search"
                  className={controlClass}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="create-room-field">
                <span>League template</span>
                <select
                  className={controlClass}
                  name="template"
                  value={values.template ?? ''}
                  onChange={(event) => {
                    const choice = choices.find(
                      (item) => roomChoiceKey(item) === event.target.value,
                    );
                    if (choice) choose(choice);
                  }}
                >
                  <option value="">Choose a template</option>
                  {templates.map((choice) => (
                    <option
                      key={roomChoiceKey(choice)}
                      value={roomChoiceKey(choice)}
                    >
                      {choice.label} · {choice.leagues.join(', ')}
                    </option>
                  ))}
                </select>
              </label>
              <noscript>
                <button
                  type="submit"
                  name="intent"
                  value="template"
                  formNoValidate
                  className={buttonClass('secondary')}
                >
                  Apply template
                </button>
              </noscript>
              <p>Based on {draft.basis.label}</p>
            </details>
          ) : null}
        </section>
        <section
          className="create-room-section"
          aria-labelledby="create-settings-title"
        >
          <h2 id="create-settings-title" tabIndex={-1}>
            Room settings
          </h2>
          <div className="create-room-resolution">
            <label className="create-room-field">
              <span>Resolution</span>
              <select
                name="resolutionMethod"
                className={controlClass}
                value={values.resolutionMethod}
                onChange={(event) =>
                  change('resolutionMethod', event.target.value)
                }
              >
                <option value="policy">Policy res</option>
                <option value="value">Value res</option>
                <option value="strike">Strike</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <noscript>
              <button
                type="submit"
                name="intent"
                value="configure"
                formNoValidate
                className={buttonClass('secondary')}
              >
                Apply resolution choice
              </button>
            </noscript>
            {publication ? (
              <blockquote>{publication.text}</blockquote>
            ) : missingPublication ? (
              <p role="status">
                That resolution is unavailable. Choose another option or try
                again later.
              </p>
            ) : values.resolutionMethod === 'strike' ? (
              <p>Chosen by strike before the round</p>
            ) : null}
            <div hidden={values.resolutionMethod !== 'custom'}>
              <label className="create-room-field">
                <span>Custom resolution</span>
                <textarea
                  name="customResolution"
                  className={controlClass}
                  value={values.customResolution ?? ''}
                  onChange={(event) =>
                    change('customResolution', event.target.value)
                  }
                  required={values.resolutionMethod === 'custom'}
                  maxLength={300}
                  rows={3}
                />
              </label>
            </div>
          </div>
          <DraftSettings
            draft={draft}
            values={values}
            change={change}
            schedule={schedule}
          />
        </section>
        <section className="create-room-section">
          <label className="create-room-field">
            <span>Who can join</span>
            <select
              name="visibility"
              className={controlClass}
              value={values.visibility ?? 'unlisted'}
              onChange={(event) => metadata('visibility', event.target.value)}
            >
              <option value="unlisted">Anyone with the link</option>
              <option value="public">Listed in the lobby</option>
            </select>
          </label>
        </section>
        <div className="create-room-actions">
          <button
            type="submit"
            name="intent"
            value="configure"
            formNoValidate
            className={buttonClass('secondary')}
          >
            Update preview
          </button>
          <button
            type="submit"
            name="intent"
            value="create"
            className={buttonClass('primary')}
            disabled={pending || missingPublication}
          >
            {pending ? 'Creating…' : 'Create room'}
          </button>
        </div>
      </fieldset>
      <DraftPreview draft={draft} title={values.title ?? ''} />
    </div>
  );
}
