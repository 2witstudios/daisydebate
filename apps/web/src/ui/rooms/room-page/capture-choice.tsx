import type { RoomView } from '@daisy/protocol';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import {
  DEFAULT_RELEASE_CHOICE,
  captureLine,
  releaseAtValue,
  releaseChoiceOf,
  releaseChoices,
} from '../../../features/rooms/capture-form';
import type { FormAction } from '../../form-action/form-action';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';

export const capturePremiumText =
  'Broadcasting and recording a casual round come with a subscription.';

/**
 * The host's two separate choices and the release choice (WATCH-8). Plain
 * fields in a native form, so all of it works with no script; choosing asks
 * every seat to Ready again, with the notice saying what was chosen.
 */
export function CaptureChoice({
  view,
  commandId,
  action,
}: {
  readonly view: Pick<RoomView, 'captureOffer' | 'capture' | 'version'>;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
}) {
  if (view.captureOffer === null) return null;
  if (view.captureOffer === 'premium')
    return (
      <>
        <p role="status" className="text-sm text-ink-muted">
          {capturePremiumText}
        </p>
        {/* Losing the grant never traps a Room: no choice posted clears it. */}
        {view.capture ? (
          <AssemblyCommandForm action={action} className="flex flex-col gap-3">
            <AssemblyCommandFields
              type="set-capture"
              version={view.version}
              commandId={commandId}
            />
            <button type="submit" className="self-start text-sm font-strong">
              Turn off broadcast and recording
            </button>
          </AssemblyCommandForm>
        ) : null}
      </>
    );
  const broadcast = view.capture?.broadcast ?? null;
  return (
    <AssemblyCommandForm action={action} className="flex flex-col gap-3">
      <AssemblyCommandFields
        type="set-capture"
        version={view.version}
        commandId={commandId}
      />
      <div className="flex w-full flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="broadcast"
            defaultChecked={broadcast !== null}
          />
          Broadcast this round to its audience
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Release the broadcast
          <select
            name="release"
            defaultValue={
              broadcast
                ? releaseChoiceOf(broadcast.release)
                : DEFAULT_RELEASE_CHOICE
            }
          >
            {releaseChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Set time, in UTC, if you chose one
          <input
            type="datetime-local"
            name="releaseAt"
            defaultValue={broadcast ? releaseAtValue(broadcast.release) : ''}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="debatersReadChat"
            defaultChecked={broadcast?.debatersReadChat ?? true}
          />
          Debaters can read spectator chat during the round
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="recording"
            defaultChecked={view.capture?.recording ?? false}
          />
          Record this round
        </label>
        <button type="submit" className="self-start text-sm font-strong">
          Save broadcast and recording
        </button>
      </div>
    </AssemblyCommandForm>
  );
}

/** The choice in words, for every participant before Ready. */
export function CaptureSummary({
  capture,
}: {
  readonly capture: RoomView['capture'];
}) {
  return capture ? (
    <p role="note" className="w-full text-sm font-strong">
      {captureLine(capture)}
    </p>
  ) : null;
}
