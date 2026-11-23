'use client';
import { Announcement } from '../components/announcement/announcement';
import { useId } from 'react';
import type { StandingLobbyChoice } from '@daisy/protocol/lobby/eligibility';
import { hostingOffers } from '@daisy/protocol/lobby/hosting-tier';
import { destinationOf, formFields } from '../../features/forms/form-state';
import {
  createTournamentUnacknowledged,
  initialCreateTournament,
  type CreateTournamentState,
} from '../../features/hosting-purchases/create-tournament-form';
import { ageRuleLabels } from '../../features/tab/tournament-age-rule';
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
  standingLobbies,
}: {
  readonly standingLobbies?: readonly StandingLobbyChoice[];
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
  const title = standingLobbies ? 'League tournament' : 'One tournament';
  const unacknowledged = state.kind === 'unacknowledged';
  const notice = unacknowledged
    ? 'The answer was lost. Retry, or reload to see whether it was made.'
    : fields.error;
  useFocusAfterAnswer(state, notice ? noticeId : undefined, !pending);
  return (
    <form
      action={submit}
      aria-busy={pending}
      aria-label={title}
      className="flex min-w-0 flex-1 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-6"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-heavy tracking-wider text-ink-muted uppercase">
          Host
        </h3>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl font-bold">{title}</p>
          {standingLobbies ? null : (
            <span className="font-strong">Free up to 16 entries</span>
          )}
        </div>
        {standingLobbies ? null : (
          <p className="text-ink-muted">
            A single event: invitational, scrimmage or club night. Upgrade this
            one event later if it grows.
          </p>
        )}
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
            readOnly={unacknowledged}
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
        {standingLobbies ? (
          <label className={fieldClass}>
            <span className={labelClass}>Standing lobby</span>
            <select
              name="standingLobbyId"
              className={controlClass}
              defaultValue={fields.values.standingLobbyId ?? ''}
              required
            >
              <option value="" disabled>
                Choose a standing lobby
              </option>
              {standingLobbies.map((lobby) => (
                <option key={lobby.id} value={lobby.id}>
                  {lobby.name} · {ageRuleLabels[lobby.ageRule]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 font-strong">Age rule</legend>
            <div className="flex gap-2 max-compact:flex-col">
              {(
                [
                  { value: 'under-18', title: 'Youth', detail: 'Under 18' },
                  { value: 'adults', title: 'Adults', detail: '18 and over' },
                  {
                    value: 'anyone',
                    title: 'Anyone',
                    detail: 'Any admitted age',
                  },
                ] as const
              ).map((choice) => (
                <label
                  key={choice.value}
                  className="flex min-h-room-target flex-1 cursor-pointer items-start gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2 has-checked:border-2 has-checked:border-ink"
                >
                  <input
                    type="radio"
                    name="ageRule"
                    value={choice.value}
                    defaultChecked={
                      (fields.values.ageRule ?? 'adults') === choice.value
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
          </fieldset>
        )}
        <div className="flex flex-col gap-2">
          <Button type="submit" className="self-start">
            {unacknowledged ? 'Retry creating it' : 'Create tournament'}
          </Button>
          {standingLobbies ? null : (
            <span className="text-sm text-ink-muted">
              Upgrade the event any time:{' '}
              {formatUsd(hostingOffers.event_64.unitAmount)} up to 64 entries,{' '}
              {formatUsd(hostingOffers.event_unlimited.unitAmount)} unlimited.
              Recording comes with it.
            </span>
          )}
        </div>
      </fieldset>
      {notice ? (
        <Announcement
          as="p"
          id={noticeId}
          tabIndex={-1}
          kind="progress"
          className="text-sm"
        >
          {notice}
        </Announcement>
      ) : null}
    </form>
  );
}
