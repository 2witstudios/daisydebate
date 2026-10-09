import type { RoomView } from '@daisy/protocol';
import type { MockFormState } from '../../../features/mock-form/form';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';

export function NumberField({
  name,
  label,
  ms,
  min,
  max,
  state,
  disabled,
  required = false,
}: {
  readonly name: string;
  readonly label: string;
  readonly ms: number | null;
  readonly min: number;
  readonly max: number;
  readonly state: MockFormState;
  readonly disabled: boolean;
  readonly required?: boolean;
}) {
  return (
    <FormField id={`setting-${name}`} label={`${label} (seconds)`}>
      <input
        id={`setting-${name}`}
        name={name}
        type="number"
        step="0.001"
        min={min / 1000}
        max={max / 1000}
        required={required}
        disabled={disabled}
        defaultValue={
          state.values[name] ?? (ms === null ? '' : String(ms / 1000))
        }
        className={controlClass}
      />
    </FormField>
  );
}
function ChoiceField({
  name,
  label,
  choices,
  saved,
  state,
  disabled,
}: {
  readonly name: string;
  readonly label: string;
  readonly choices: readonly string[];
  readonly saved: string;
  readonly state: MockFormState;
  readonly disabled: boolean;
}) {
  return (
    <FormField id={`setting-${name}`} label={label}>
      <select
        id={`setting-${name}`}
        name={name}
        defaultValue={state.values[name] ?? saved}
        disabled={disabled}
        className={controlClass}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice.replaceAll('_', ' ')}
          </option>
        ))}
      </select>
    </FormField>
  );
}
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
  return (
    <>
      {capability.preRoundPrep ? (
        <fieldset className="flex flex-col gap-3">
          <legend>Pre-round preparation</legend>
          <label>
            <input
              type="checkbox"
              name="preRoundPrep"
              disabled={disabled}
              defaultChecked={
                state.error
                  ? state.values.preRoundPrep === 'on'
                  : view.config.preRoundPrep.enabled
              }
            />{' '}
            Enable preparation before Launch
          </label>
          <NumberField
            name="preRoundSeconds"
            label="Preparation duration"
            ms={
              view.config.preRoundPrep.enabled
                ? view.config.preRoundPrep.durationMs
                : null
            }
            min={capability.preRoundPrep.durationMs.min}
            max={capability.preRoundPrep.durationMs.max}
            state={state}
            disabled={disabled}
          />
        </fieldset>
      ) : null}
      {capability.inRoundPrep ? (
        <fieldset className="flex flex-col gap-3">
          <legend>In-round preparation</legend>
          <label>
            <input
              type="checkbox"
              name="inRoundPrep"
              disabled={disabled}
              defaultChecked={
                state.error
                  ? state.values.inRoundPrep === 'on'
                  : view.config.inRoundPrep.enabled
              }
            />{' '}
            Enable preparation during the Round
          </label>
          <NumberField
            name="budgetSeconds"
            label="Budget per side"
            ms={
              view.config.inRoundPrep.enabled
                ? view.config.inRoundPrep.budgetMsPerSide
                : null
            }
            min={capability.inRoundPrep.budgetMsPerSide.min}
            max={capability.inRoundPrep.budgetMsPerSide.max}
            state={state}
            disabled={disabled}
          />
        </fieldset>
      ) : null}
    </>
  );
}
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
        label="Cross-examination floor"
        choices={capability.crossExModes}
        saved={view.config.crossExamination.crossExMode}
        state={state}
        disabled={disabled}
      />
      {capability.interruptions ? (
        <fieldset className="flex flex-col gap-3">
          <legend>Interruptions</legend>
          <ChoiceField
            name="interruptionsMode"
            label="Interruption policy"
            choices={capability.interruptions.modes}
            saved={view.config.interruptions?.mode ?? ''}
            state={state}
            disabled={disabled}
          />
          <NumberField
            name="minRemaining"
            label="Minimum remaining time"
            ms={view.config.interruptions?.minRemainingMs ?? null}
            min={capability.interruptions.minRemainingMs.min}
            max={capability.interruptions.minRemainingMs.max}
            state={state}
            disabled={disabled}
          />
        </fieldset>
      ) : null}
      {capability.yield ? (
        <fieldset className="flex flex-col gap-3">
          <legend>Yielding</legend>
          <ChoiceField
            name="yieldAllowed"
            label="Allow yielding"
            choices={capability.yield.enabledChoices.map(String)}
            saved={String(view.config.yielding?.allowed)}
            state={state}
            disabled={disabled}
          />
          <ChoiceField
            name="yieldReturns"
            label="Return unused time"
            choices={capability.yield.returnsTimeChoices.map(String)}
            saved={String(view.config.yielding?.returnsTime)}
            state={state}
            disabled={disabled}
          />
        </fieldset>
      ) : null}
    </>
  );
}
