'use client';
import { Announcement } from '../../components/announcement/announcement';
import { useId } from 'react';
import type { TournamentSetup } from '../../../features/tab/setup';
import { formFields, destinationOf } from '../../../features/forms/form-state';
import {
  initialSetupPairing,
  setupPairingUnacknowledged,
  type SetupPairingState,
} from '../../../features/tab/setup-pairing-form';
import {
  useFormAction,
  useFocusAfterAnswer,
} from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { PairingPolicies } from './setup';
import { ChoiceField } from '../choice-field/choice-field';
import { Button } from '../../components/button/button';
export function SetupPairingForm({
  pairing,
  action,
}: {
  readonly pairing: TournamentSetup['pairing'];
  readonly action: (
    previous: SetupPairingState,
    form: FormData,
  ) => Promise<SetupPairingState>;
}) {
  const [state, submit, pending] = useFormAction(
    action,
    initialSetupPairing(pairing.preset.value),
    setupPairingUnacknowledged,
  );
  const fields = formFields(state);
  const next = destinationOf(state);
  useMovedOn(next);
  const noticeId = useId();
  useFocusAfterAnswer(
    state,
    fields.error || state.kind === 'unacknowledged' ? noticeId : undefined,
    !pending,
  );
  return (
    <form
      action={submit}
      aria-label="Pairing"
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <h2 className="font-display text-xl font-bold">Pairing</h2>
      <fieldset
        disabled={pending || next !== undefined}
        className="flex flex-col gap-4"
      >
        {state.kind === 'unacknowledged' ? (
          <input
            type="hidden"
            name="pairing-preset"
            value={fields.values['pairing-preset']}
          />
        ) : null}
        <fieldset disabled={state.kind === 'unacknowledged'}>
          <ChoiceField
            key={fields.values['pairing-preset']}
            id="pairing-preset"
            choice={{
              ...pairing.preset,
              value: fields.values['pairing-preset'] ?? pairing.preset.value,
            }}
          />
        </fieldset>
        <PairingPolicies pairing={pairing} />
        <Button type="submit" className="self-start">
          {state.kind === 'unacknowledged' ? 'Retry save' : pairing.save.label}
        </Button>
      </fieldset>
      {fields.error || state.kind === 'unacknowledged' ? (
        <Announcement
          as="p"
          id={noticeId}
          tabIndex={-1}
          kind="progress"
          className="text-sm text-ink"
        >
          {state.kind === 'unacknowledged'
            ? 'The answer was lost. Retry the same selection, or reload to check what was saved.'
            : fields.error}
        </Announcement>
      ) : null}
    </form>
  );
}
