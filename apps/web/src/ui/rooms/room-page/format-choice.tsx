'use client';

import { useId, useSyncExternalStore } from 'react';
import type { RoomCatalogChoice, RoomView } from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { RoomCommandIds } from '../../../features/rooms/room-command-ids';
import {
  choiceSummary,
  standardOptions,
} from '../../../features/rooms/format-browser';
import { formatChangeLine } from '../../../features/rooms/format-changes';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyCommandForm } from './assembly-command-form';
import { FormatTemplatePicker } from '../create-room/format-template-picker';
import { formatTitle } from './room-labels';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';

const subscribeNever = () => () => undefined;

/** One radio or select value names one catalog tuple; the form decoder spreads it. */
const tuple = (format: {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number;
}) =>
  JSON.stringify({
    formatId: format.formatId,
    formatVersion: format.formatVersion,
    presetVersion: format.presetVersion,
  });

function CommandFields({
  view,
  commandId,
  intent,
}: {
  readonly view: RoomView;
  readonly commandId: string;
  readonly intent: 'choose' | 'reset';
}) {
  return (
    <>
      <input type="hidden" name="type" value="select-format" />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="expectedVersion" value={view.version} />
    </>
  );
}

/**
 * Leaving a draw needs the resolution the new format debates (FMT-2b). The
 * field is optional because choosing another draw format must send none;
 * the server refuses whichever choice the field does not fit.
 */
function ResolutionField({ id }: { readonly id: string }) {
  return (
    <FormField id={id} label="Resolution">
      <input
        id={id}
        name="topic"
        aria-describedby={`${id}-hint`}
        className={controlClass}
      />
      <span id={`${id}-hint`} className="text-xs text-ink-muted">
        Needed to switch to a format with a set resolution. Leave it empty for
        one that strikes its resolution.
      </span>
    </FormField>
  );
}

const leagueField = {
  name: 'format',
  label: 'Start from a league format',
  id: 'room-league-format',
};

const optionClass =
  'relative flex min-h-room-target flex-col gap-1 rounded-lg border border-border p-3 has-checked:border-2 has-checked:border-accent has-checked:bg-surface-raised';

type FormProps = {
  readonly view: RoomView;
  readonly choices: readonly RoomCatalogChoice[];
  readonly ids: RoomCommandIds['format'];
  readonly action: FormAction<RoomFormState>;
};

const choiceTuple = (choice: RoomCatalogChoice) =>
  tuple({
    formatId: choice.formatId,
    formatVersion: choice.formatVersion,
    presetVersion: choice.preset.version,
  });

/** In a draw room a set-resolution choice needs typed text (FMT-2b). */
const drawing = (view: RoomView) => view.executionPlan.resolutionDraw.enabled;

/** The standards and Custom, one radio each; outside a draw, choosing submits at once. */
function StandardsForm({ view, choices, ids, action }: FormProps) {
  const interactive = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const legendId = useId();
  const standing = view.format.standing;
  const draws = drawing(view);
  return (
    <AssemblyCommandForm action={action} className="flex flex-col gap-3">
      <CommandFields view={view} commandId={ids.choose} intent="choose" />
      <span id={legendId} className="text-sm font-strong">
        Format
      </span>
      <div
        role="radiogroup"
        aria-labelledby={legendId}
        className="grid w-full grid-cols-2 gap-2 max-compact:grid-cols-1"
      >
        {standardOptions(choices).map((choice) => (
          <label key={choice.formatId} className={optionClass}>
            <input
              type="radio"
              name="format"
              className="sr-only"
              value={choiceTuple(choice)}
              defaultChecked={
                standing.kind === 'standard' &&
                standing.formatId === choice.formatId
              }
              onChange={(event) =>
                draws ? undefined : event.currentTarget.form?.requestSubmit()
              }
            />
            <span className="font-strong">{choice.label}</span>
            <span className="text-xs text-ink-muted">
              {choiceSummary(choice)}
            </span>
          </label>
        ))}
        <label className={optionClass}>
          <input
            type="radio"
            name="format"
            className="sr-only"
            value="custom"
            defaultChecked={standing.kind === 'custom'}
            disabled={standing.kind !== 'custom'}
          />
          <span className="font-strong">Custom</span>
          <span className="text-xs text-ink-muted">
            Change any time or rule, or start from a league format.
          </span>
        </label>
      </div>
      {draws ? <ResolutionField id="room-format-topic" /> : null}
      <button
        type="submit"
        hidden={interactive && !draws}
        className={buttonClass('secondary')}
      >
        Use this format
      </button>
    </AssemblyCommandForm>
  );
}

/** What the room changed from its basis, and Back to a standard basis. */
function CustomCard({ view, choices, ids, action }: FormProps) {
  const { standing, basis } = view.format;
  if (standing.kind !== 'custom') return null;
  const basisDraws = choices.find(
    (choice) => choice.formatId === basis?.formatId,
  )?.preset.config.resolutionDraw.enabled;
  return (
    <section
      aria-label="Custom format"
      className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4"
    >
      <p className="font-strong">{formatTitle(view.format)}</p>
      {standing.changes.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {standing.changes.map((change) => (
            <li key={formatChangeLine(change)}>{formatChangeLine(change)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">No changes</p>
      )}
      {standing.basis?.role === 'standard' && basis ? (
        <AssemblyCommandForm action={action}>
          <CommandFields view={view} commandId={ids.reset} intent="reset" />
          <input type="hidden" name="format" value={tuple(basis)} />
          {drawing(view) && basisDraws === false ? (
            <ResolutionField id="room-reset-topic" />
          ) : null}
          <button type="submit" className={buttonClass('secondary')}>
            Back to {basis.name}
          </button>
        </AssemblyCommandForm>
      ) : null}
    </section>
  );
}

/** The league browser: a template starts the room as Custom, based on it. */
function LeagueForm({ view, choices, ids, action }: FormProps) {
  const templates = choices.filter((choice) => choice.role === 'template');
  if (!templates.length) return null;
  return (
    <AssemblyCommandForm action={action} className="flex flex-col gap-2">
      <CommandFields view={view} commandId={ids.template} intent="choose" />
      <FormatTemplatePicker
        choices={templates}
        field={leagueField}
        serialize={choiceTuple}
      />
      {drawing(view) ? <ResolutionField id="room-league-topic" /> : null}
      <p className="text-xs text-ink-muted">
        The room becomes Custom, based on the league’s rules.
      </p>
      <button type="submit" className={buttonClass('secondary')}>
        Start from this format
      </button>
    </AssemblyCommandForm>
  );
}

/**
 * Room setup's format: Daisy's standards and Custom (FMT-3, FMT-4). Choosing
 * a standard posts select-format; Custom is never chosen directly, it is
 * what any edit makes the room. Every form works without JavaScript.
 */
export function FormatChoice(props: FormProps) {
  return (
    <div className="flex flex-col gap-4">
      <StandardsForm {...props} />
      <CustomCard {...props} />
      <LeagueForm {...props} />
    </div>
  );
}
