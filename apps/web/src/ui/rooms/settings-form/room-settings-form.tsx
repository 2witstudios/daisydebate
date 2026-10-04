'use client';

import { prepChoices, speechChoices } from '../../../features/rooms/settings';
import { buttonClass } from '../../components/button/button-class';
import {
  controlClass,
  fieldClass,
  labelClass,
} from '../../components/form-field/form-field-class';
import { FormError } from '../../components/form-field/form-field';
import { MockForm, type MockFormAction } from '../../form-action/mock-form';

/**
 * The host's timings, a real POST: it works before hydration and without
 * JavaScript. Saving clears every ready flag, because nobody should start
 * under rules they did not see.
 */
export function RoomSettingsForm({
  action,
  speech,
  prep,
}: {
  readonly action: MockFormAction;
  readonly speech: number;
  readonly prep: number;
}) {
  return (
    <MockForm
      action={action}
      label="Room timings"
      className="flex flex-col gap-3"
    >
      {({ values, error, pending }) => (
        <>
          <div className={fieldClass}>
            <label htmlFor="room-speech" className={labelClass}>
              Speech length
            </label>
            <select
              id="room-speech"
              name="speech"
              defaultValue={values['speech'] ?? String(speech)}
              className={controlClass}
            >
              {speechChoices.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {`${minutes} minutes`}
                </option>
              ))}
            </select>
          </div>
          <div className={fieldClass}>
            <label htmlFor="room-prep" className={labelClass}>
              Prep time
            </label>
            <select
              id="room-prep"
              name="prep"
              defaultValue={values['prep'] ?? String(prep)}
              className={controlClass}
            >
              {prepChoices.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {`${minutes} minutes`}
                </option>
              ))}
            </select>
          </div>
          <FormError error={error} />
          <button
            type="submit"
            disabled={pending}
            className={buttonClass('secondary')}
          >
            {pending ? 'Saving…' : 'Save settings'}
          </button>
        </>
      )}
    </MockForm>
  );
}
