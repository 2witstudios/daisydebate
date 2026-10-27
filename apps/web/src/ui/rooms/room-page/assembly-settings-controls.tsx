import type { ReactNode } from 'react';
import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import { controlClass } from '../../components/form-field/form-field-class';
import { clockDuration } from '../../../features/rooms/duration-input';
import {
  yieldChoiceOf,
  yieldChoices,
} from '../../../features/rooms/yield-choice';
import {
  crossExModeLabel,
  interruptionLabel,
  yieldLabel,
} from '../../../features/debate-room/vocabulary';

/** One m:ss field; the bounds come from the format and the server checks them again. */
export function DurationField({
  name,
  label,
  hint,
  ms,
  min,
  max,
  state,
  disabled,
  required = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly ms: number | null;
  readonly min: number;
  readonly max: number;
  readonly state: MockFormState;
  readonly disabled: boolean;
  readonly required?: boolean;
}) {
  const field = `duration.${name}`;
  const id = `setting-${field}`;
  const boundsId = `${id}-bounds`;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="min-w-0 flex-1 text-sm">
        <span className="font-strong">{label}</span>
        {hint ? (
          <span className="block text-xs text-ink-muted">{hint}</span>
        ) : null}
      </label>
      <span id={boundsId} className="text-xs text-ink-muted tabular-nums">
        {clockDuration(min)}–{clockDuration(max)}
      </span>
      <input
        id={id}
        name={field}
        autoComplete="off"
        placeholder="m:ss"
        pattern="\d{1,6}:[0-5]\d(\.\d{1,3})?"
        title="Minutes and seconds, like 5:00"
        required={required}
        disabled={disabled}
        aria-describedby={boundsId}
        defaultValue={
          state.values[field] ?? (ms === null ? '' : clockDuration(ms))
        }
        className={`${controlClass} w-room-duration text-center tabular-nums`}
      />
    </div>
  );
}

type Choice = {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
};

/** A native radio group: every value the format permits, named in words. */
function ChoiceField({
  name,
  legend,
  hint,
  choices,
  saved,
  state,
  disabled,
}: {
  readonly name: string;
  readonly legend: string;
  readonly hint?: string;
  readonly choices: readonly Choice[];
  readonly saved: string;
  readonly state: MockFormState;
  readonly disabled: boolean;
}) {
  const selected = state.values[name] ?? saved;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-strong">{legend}</legend>
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
      {choices.map((choice) => (
        <label
          key={choice.value}
          className="flex min-h-room-target items-start gap-3 text-sm"
        >
          <input
            type="radio"
            name={name}
            value={choice.value}
            disabled={disabled}
            defaultChecked={selected === choice.value}
            className="mt-1 size-4 shrink-0"
          />
          <span>
            {choice.label}
            {choice.detail ? (
              <span className="text-ink-muted"> — {choice.detail}</span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function PrepToggle({
  name,
  label,
  hint,
  checked,
  state,
  disabled,
  children,
}: {
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly state: MockFormState;
  readonly disabled: boolean;
  readonly children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{label}</legend>
      <label className="flex min-h-room-target items-start gap-3 text-sm">
        <input
          type="checkbox"
          name={name}
          disabled={disabled}
          defaultChecked={state.error ? state.values[name] === 'on' : checked}
          className="mt-1 size-4 shrink-0"
        />
        <span>
          <span className="font-strong">{label}</span>
          <span className="block text-xs text-ink-muted">{hint}</span>
        </span>
      </label>
      <div className="pl-8">{children}</div>
    </fieldset>
  );
}

/** Prep before the round and prep time between speeches: the basics. */
export function PreparationFields({
  view,
  state,
  disabled,
}: {
  readonly view: RoomView;
  readonly state: MockFormState;
  readonly disabled: boolean;
}) {
  const capability = view.definition.configurable;
  const { preRoundPrep, inRoundPrep } = view.config;
  return (
    <>
      {capability.preRoundPrep ? (
        <PrepToggle
          name="preRoundPrep"
          label="Prep before the round"
          hint="Both sides prepare once everyone is seated, before the first speech."
          checked={preRoundPrep.enabled}
          state={state}
          disabled={disabled}
        >
          <DurationField
            name="preRound"
            label="Length"
            ms={preRoundPrep.enabled ? preRoundPrep.durationMs : null}
            min={capability.preRoundPrep.durationMs.min}
            max={capability.preRoundPrep.durationMs.max}
            state={state}
            disabled={disabled}
          />
        </PrepToggle>
      ) : null}
      {capability.inRoundPrep ? (
        <PrepToggle
          name="inRoundPrep"
          label="Prep time during the round"
          hint="Each side can pause between speeches to prepare, up to this total."
          checked={inRoundPrep.enabled}
          state={state}
          disabled={disabled}
        >
          <DurationField
            name="budget"
            label="Per side"
            ms={inRoundPrep.enabled ? inRoundPrep.budgetMsPerSide : null}
            min={capability.inRoundPrep.budgetMsPerSide.min}
            max={capability.inRoundPrep.budgetMsPerSide.max}
            state={state}
            disabled={disabled}
          />
        </PrepToggle>
      ) : null}
    </>
  );
}

const crossExDetail = {
  ordered: 'the asking side controls the floor',
  free: 'either side may speak',
} as const;

/** Cross-examination, interruptions and ending early: the advanced rules. */
export function InteractionFields({
  view,
  state,
  disabled,
}: {
  readonly view: RoomView;
  readonly state: MockFormState;
  readonly disabled: boolean;
}) {
  const capability = view.definition.configurable.interaction;
  return (
    <>
      <ChoiceField
        name="crossExMode"
        legend="Cross-examination"
        choices={capability.crossExModes.map((mode) => ({
          value: mode,
          label: crossExModeLabel[mode],
          detail: crossExDetail[mode],
        }))}
        saved={view.config.crossExamination.crossExMode}
        state={state}
        disabled={disabled}
      />
      {capability.interruptions ? (
        <div className="flex flex-col gap-2">
          <ChoiceField
            name="interruptionsMode"
            legend="Interruptions"
            choices={capability.interruptions.modes.map((mode) => ({
              value: mode,
              label: interruptionLabel[mode],
            }))}
            saved={view.config.interruptions?.mode ?? ''}
            state={state}
            disabled={disabled}
          />
          <DurationField
            name="minRemaining"
            label="Protect the end of each speech"
            hint="No interruptions once this little time is left."
            ms={view.config.interruptions?.minRemainingMs ?? null}
            min={capability.interruptions.minRemainingMs.min}
            max={capability.interruptions.minRemainingMs.max}
            state={state}
            disabled={disabled}
          />
        </div>
      ) : null}
      {capability.yield ? (
        <ChoiceField
          name="yield"
          legend="Ending a speech early"
          hint="When on, the speaker sees an End speech button."
          choices={yieldChoices(capability.yield, view.config.yielding).map(
            ([value, yielding]) => ({ value, label: yieldLabel(yielding) }),
          )}
          saved={
            view.config.yielding ? yieldChoiceOf(view.config.yielding) : ''
          }
          state={state}
          disabled={disabled}
        />
      ) : null}
    </>
  );
}
