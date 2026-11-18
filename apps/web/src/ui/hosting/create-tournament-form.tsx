'use client';
import { useId } from 'react';
import { hostingOffers } from '@daisy/protocol/lobby/hosting-tier';
import { destinationOf, formFields } from '../../features/forms/form-state';
import {
  createTournamentUnacknowledged,
  initialCreateTournament,
  type CreateTournamentState,
} from '../../features/hosting-purchases/create-tournament-form';
import { formatUsd } from '../../features/hosting-purchases/hosting-words';
import { useFocusAfterAnswer, useFormAction } from '../form-action/form-action';
import { useMovedOn } from '../form-action/use-moved-on';
import { Button } from '../components/button/button';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../components/form-field/form-field-class';

/** One tournament (PHostHome): a name and its style, free up to 16 entries. */
export function CreateTournamentForm({
  action,
}: {
  readonly action: (
    previous: CreateTournamentState,
    form: FormData,
  ) => Promise<CreateTournamentState>;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialCreateTournament,
    createTournamentUnacknowledged,
  );
  const fields = formFields(state);
  const next = destinationOf(state);
  useMovedOn(next);
  const nameId = useId(),
    styleId = useId(),
    noticeId = useId();
  useFocusAfterAnswer(
    state,
    fields.error || state.kind === 'unacknowledged' ? noticeId : undefined,
    !pending,
  );
  return (
    <form
      action={submit}
      aria-busy={pending}
      aria-label="One tournament"
      className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-6"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
          Host
        </h3>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl font-bold">One tournament</p>
          <span className="font-strong">Free up to 16 entries</span>
        </div>
        <p className="text-ink-muted">
          A single event: invitational, scrimmage or club night. Upgrade this
          one event later if it grows.
        </p>
      </div>
      <fieldset
        disabled={pending || next !== undefined}
        className="flex flex-col gap-4"
      >
        <div className={fieldClass}>
          <label htmlFor={nameId} className={labelClass}>
            Name
          </label>
          <input
            id={nameId}
            name="name"
            required
            maxLength={120}
            defaultValue={fields.values.name ?? ''}
            readOnly={state.kind === 'unacknowledged'}
            className={controlClass}
          />
        </div>
        <div className={fieldClass}>
          <label htmlFor={styleId} className={labelClass}>
            Style
          </label>
          <select id={styleId} name="style" className={controlClass}>
            <option value="freestyle">Freestyle</option>
          </select>
        </div>
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 font-strong">Division</legend>
          <div className="flex gap-2 max-compact:flex-col">
            {(
              [
                { value: 'youth', title: 'Youth', detail: 'Under 18' },
                { value: 'open', title: 'Open', detail: '18 and over' },
              ] as const
            ).map((choice) => (
              <label
                key={choice.value}
                className="flex min-h-room-target flex-1 cursor-pointer items-start gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 has-checked:border-2 has-checked:border-ink"
              >
                <input
                  type="radio"
                  name="division"
                  value={choice.value}
                  defaultChecked={
                    (fields.values.division ?? 'open') === choice.value
                  }
                  className="mt-1 size-4 accent-ink"
                />
                <span className="flex flex-col">
                  <strong>{choice.title}</strong>
                  <span className="text-sm text-ink-muted">
                    {choice.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <span className="text-sm text-ink-muted">
            Entries outside the division are refused at registration, with the
            reason.
          </span>
        </fieldset>
        <div className="flex flex-col gap-2">
          <Button type="submit" className="self-start">
            {state.kind === 'unacknowledged'
              ? 'Retry creating it'
              : 'Create tournament'}
          </Button>
          <span className="text-sm text-ink-muted">
            Upgrade the event any time:{' '}
            {formatUsd(hostingOffers.event_64.unitAmount)} up to 64 entries,{' '}
            {formatUsd(hostingOffers.event_unlimited.unitAmount)} unlimited.
            Recording comes with it.
          </span>
        </div>
      </fieldset>
      {fields.error || state.kind === 'unacknowledged' ? (
        <p id={noticeId} tabIndex={-1} role="status" className="text-sm">
          {state.kind === 'unacknowledged'
            ? 'The answer was lost. Retry, or reload to see whether it was made.'
            : fields.error}
        </p>
      ) : null}
    </form>
  );
}
