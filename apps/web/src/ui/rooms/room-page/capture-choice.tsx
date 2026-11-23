import { Button } from '../../components/button/button';
import type { RoomView } from '@daisy/protocol/room-contract';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import {
  DEFAULT_RELEASE_CHOICE,
  captureLine,
  releaseChoiceOf,
  releaseChoices,
} from '../../../features/rooms/capture-form';
import type { FormAction } from '../../form-action/form-action';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { UpgradePanel } from '../../components/upgrade-panel/upgrade-panel';

/**
 * The host's two separate choices and the release choice (WATCH-8). Plain
 * fields in a native form, so all of it works before hydration; choosing asks
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
        <div className="flex w-full flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" role="switch" disabled />
            Broadcast this round to its audience
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" role="switch" disabled />
            Record this round
          </label>
          <UpgradePanel
            title="Recording and broadcast are Premium"
            alternative={{ kind: 'dismiss', label: 'Not now' }}
          >
            Record your casual Rounds, stream them to an audience and download
            them with Premium.
          </UpgradePanel>
        </div>
        {/* Losing the grant never traps a Room: no choice posted clears it. */}
        {view.capture ? (
          <AssemblyCommandForm action={action} className="flex flex-col gap-3">
            <AssemblyCommandFields
              type="set-capture"
              version={view.version}
              commandId={commandId}
            />
            <Button
              variant="text"
              type="submit"
              size="small"
              className="self-start"
            >
              Turn off broadcast and recording
            </Button>
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
            defaultChecked={view.capture?.recordingPolicy === 'released'}
          />
          Record this round
        </label>
        <Button
          variant="text"
          type="submit"
          size="small"
          className="self-start"
        >
          Save broadcast and recording
        </Button>
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
    <p role="note" className="basis-full text-sm font-strong">
      {captureLine(capture)}
    </p>
  ) : null;
}
