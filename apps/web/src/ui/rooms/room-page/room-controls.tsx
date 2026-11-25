'use client';

import { useState, type ChangeEvent, type ReactNode } from 'react';
import type { RoomView } from '@daisy/protocol/room-contract';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import {
  DEFAULT_RELEASE_CHOICE,
  releaseChoiceOf,
} from '../../../features/rooms/capture-form';
import {
  roomVisibilityChoices,
  roomVisibilityLabels,
} from '../../../features/rooms/room-visibility';
import type { FormAction } from '../../form-action/form-action';
import { controlClass } from '../../components/form-field/form-field-class';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import {
  UpgradeLine,
  UpgradePanel,
} from '../../components/upgrade-panel/upgrade-panel';
import { aiJudgeUpgradeShown } from './ai-judge-notice';

type View = Pick<
  RoomView,
  | 'version'
  | 'visibility'
  | 'capture'
  | 'captureOffer'
  | 'capabilities'
  | 'aiJudgeSeating'
  | 'definition'
>;

/** A choice posts as soon as it changes: the page needs script (ADR 0114). */
const submitOnChange = (
  event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
) => event.currentTarget.form?.requestSubmit();

function Row({
  label,
  htmlFor,
  value,
  detail,
}: {
  readonly label: string;
  readonly htmlFor?: string;
  readonly value: ReactNode;
  readonly detail?: string | null;
}) {
  return (
    <div className="flex min-h-room-target flex-col justify-center">
      <div className="flex items-center justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-strong">
            {label}
          </label>
        ) : (
          <span className="text-sm font-strong">{label}</span>
        )}
        {value}
      </div>
      {detail ? <p className="text-xs text-ink-muted">{detail}</p> : null}
    </div>
  );
}

/** Who can join, posted alone (ADR 0145, D9). */
function WhoCanJoin({
  view,
  commandId,
  action,
}: {
  readonly view: View;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
}) {
  const label = roomVisibilityLabels[view.visibility];
  if (!view.capabilities.canEdit)
    return (
      <Row
        label="Who can join"
        value={<span className="text-sm">{label}</span>}
      />
    );
  const choices = roomVisibilityChoices.some((c) => c.value === view.visibility)
    ? roomVisibilityChoices
    : [...roomVisibilityChoices, { value: view.visibility, label, detail: '' }];
  return (
    <AssemblyCommandForm action={action}>
      <AssemblyCommandFields
        type="set-visibility"
        version={view.version}
        commandId={commandId}
      />
      <Row
        label="Who can join"
        htmlFor="room-visibility"
        value={
          <select
            id="room-visibility"
            name="visibility"
            key={view.visibility}
            defaultValue={view.visibility}
            onChange={submitOnChange}
            className={`${controlClass} w-auto`}
          >
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        }
      />
    </AssemblyCommandForm>
  );
}

const delayWords = (seconds: number) =>
  seconds < 60 ? `${seconds} s delay` : `${seconds / 60} min delay`;

/**
 * One capture switch. The form carries the rest of the saved choice, so
 * turning one on or off leaves the other as it was (WATCH-8).
 */
function CaptureSwitch({
  view,
  which,
  commandId,
  action,
  onReach,
}: {
  readonly view: View;
  readonly which: 'broadcast' | 'recording';
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
  /** A free host reaching for a Premium switch: show the upgrade panel (PYL-11). */
  readonly onReach: () => void;
}) {
  const broadcast = view.capture?.broadcast ?? null;
  const policy = view.capture?.recordingPolicy ?? 'off';
  // The page's switch records for release, as the ordinary form does; a
  // Recording kept for the officials (TAB-6.15) reads as on, and says so.
  const recording = policy === 'released';
  const on = which === 'broadcast' ? broadcast !== null : policy !== 'off';
  const label = which === 'broadcast' ? 'Broadcast' : 'Record';
  const detail =
    which === 'broadcast' && broadcast
      ? delayWords(broadcast.release.seconds)
      : which === 'recording' && policy === 'officials'
        ? 'For the officials only'
        : null;
  const premium = view.captureOffer === 'premium';
  if (!view.capabilities.canEdit)
    return (
      <Row
        label={label}
        value={<span className="text-sm">{on ? 'On' : 'Off'}</span>}
        detail={detail}
      />
    );
  const id = `room-${which}`;
  return (
    <AssemblyCommandForm action={action}>
      <AssemblyCommandFields
        type="set-capture"
        version={view.version}
        commandId={commandId}
      />
      {premium ? null : (
        // Without the grant the switch only turns everything off.
        <>
          <input
            type="hidden"
            name="release"
            value={
              broadcast
                ? releaseChoiceOf(broadcast.release)
                : DEFAULT_RELEASE_CHOICE
            }
          />
          {(broadcast?.debatersReadChat ?? true) ? (
            <input type="hidden" name="debatersReadChat" value="on" />
          ) : null}
          {which === 'recording' && broadcast ? (
            <input type="hidden" name="broadcast" value="on" />
          ) : null}
          {which === 'broadcast' && recording ? (
            <input type="hidden" name="recording" value="on" />
          ) : null}
        </>
      )}
      <Row
        label={label}
        htmlFor={id}
        detail={premium && !on ? null : detail}
        value={
          premium && !on ? (
            // Stays off and posts nothing; reaching for it opens the panel.
            <input
              id={id}
              type="checkbox"
              role="switch"
              checked={false}
              onChange={onReach}
              className="size-5 accent-accent"
            />
          ) : (
            <input
              id={id}
              type="checkbox"
              role="switch"
              name={which}
              key={String(on)}
              defaultChecked={on}
              // Losing the grant never traps a Room: it may still turn off.
              disabled={premium && !on}
              onChange={submitOnChange}
              className="size-5 accent-accent"
            />
          )
        }
      />
    </AssemblyCommandForm>
  );
}

/**
 * The Room's controls on the page (ADR 0145): who can join, broadcast and
 * record, as switches for the host and plain values for everyone else.
 * The broadcast delay and the rest of the round are in Edit settings.
 */
export function RoomControls({
  view,
  commandIds,
  commandAction,
}: {
  readonly view: View;
  readonly commandIds: {
    readonly visibility: string;
    readonly capture: string;
  };
  readonly commandAction: FormAction<RoomFormState>;
}) {
  // Each reach mounts a fresh panel, so it shows again after "Not now".
  const [reaches, setReaches] = useState(0);
  const reach = () => setReaches((count) => count + 1);
  return (
    <section
      aria-label="Room controls"
      className="flex min-w-0 flex-col divide-y divide-border rounded-xl border border-border bg-surface px-4 py-1"
    >
      <WhoCanJoin
        view={view}
        commandId={commandIds.visibility}
        action={commandAction}
      />
      {view.captureOffer === null && view.capture === null ? null : (
        <>
          <CaptureSwitch
            view={view}
            which="broadcast"
            commandId={commandIds.capture}
            action={commandAction}
            onReach={reach}
          />
          <CaptureSwitch
            view={view}
            which="recording"
            commandId={commandIds.capture}
            action={commandAction}
            onReach={reach}
          />
          {reaches > 0 && view.captureOffer === 'premium' ? (
            <div className="py-3">
              {aiJudgeUpgradeShown(view) ? (
                // The roster already shows this page's panel.
                <UpgradeLine key={reaches}>
                  Recording and broadcast are Premium.
                </UpgradeLine>
              ) : (
                <UpgradePanel
                  key={reaches}
                  title="Recording and broadcast are Premium"
                  alternative={{ kind: 'dismiss', label: 'Not now' }}
                >
                  Record your casual Rounds, stream them to an audience and
                  download them with Premium.
                </UpgradePanel>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
