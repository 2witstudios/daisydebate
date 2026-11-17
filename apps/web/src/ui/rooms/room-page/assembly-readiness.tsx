import { BotAdmissionNotice } from './bot-admission-notice';
import { AssemblyCommandForm } from './assembly-command-form';
import { ContentWaiverForm } from './content-waiver-form';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import type { ReactNode } from 'react';
import { freezePostRoundCall, type RoomView } from '@daisy/protocol';
import { AssemblyCommandFields } from './assembly-command-fields';
import { buttonClass } from '../../components/button/button-class';
import {
  ownSeat,
  readinessControl,
  type LocalReadiness,
} from './assembly-controls';
import { startRefusalText, waitingOn } from './room-labels';

/**
 * What every seat is told before Ready when the host chose the call and the
 * cast as it stands would get one: Start round freezes by the same rule (ADR 0127).
 */
export const postRoundCallText =
  'The call stays open after the round for feedback. Judges can be seen and heard. Not recorded.';

type Control = 'ready' | 'unready' | 'start-round';
type View = Pick<
  RoomView,
  | 'participants'
  | 'version'
  | 'readiness'
  | 'startRefusal'
  | 'botAdmission'
  | 'contentWaiver'
  | 'captureNotice'
  | 'capture'
  | 'postRoundCall'
  | 'teamOneSide'
  | 'status'
> & {
  readonly definition: Pick<RoomView['definition'], 'seats'>;
  readonly capabilities: Pick<
    RoomView['capabilities'],
    'canReady' | 'host' | 'canStart'
  >;
};
type Props = {
  readonly view: View;
  readonly actorId: string;
  readonly local: LocalReadiness;
  readonly action: FormAction<RoomFormState>;
  readonly waiverAction: FormAction<RoomFormState>;
  readonly commandIds: Readonly<Record<Control, string>>;
  /**
   * Turns on this tab's camera and microphone. Given, a debater whose devices
   * have not passed sees it as their one full-width button in place of a
   * disabled I'm ready (ADR 0145).
   */
  readonly turnOnDevices?: (() => void) | undefined;
};

function startFence(
  view: View,
  actorId: string,
  local: LocalReadiness,
): boolean {
  if (local.unreadyPending) return true;
  const own = ownSeat(view, actorId);
  return own?.kind === 'human' && own.role !== 'judge' && !local.devicesPassed;
}

/** One native versioned room command; CAP validates every value again. */
function CommandForm({
  type,
  version,
  commandId,
  action,
  label,
  enabled,
  expectedConsentVersion = null,
  noticeVersion = null,
  className,
}: {
  readonly type: Control;
  readonly version: number;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
  readonly label: string;
  readonly enabled: boolean;
  readonly expectedConsentVersion?: number | null;
  readonly noticeVersion?: string | null;
  readonly className: string;
}) {
  return (
    <AssemblyCommandForm action={action}>
      {AssemblyCommandFields({ type, version, commandId })}
      {expectedConsentVersion !== null ? (
        <input
          type="hidden"
          name="expectedConsentVersion"
          value={String(expectedConsentVersion)}
        />
      ) : null}
      {noticeVersion !== null ? (
        <input type="hidden" name="noticeVersion" value={noticeVersion} />
      ) : null}
      <button type="submit" disabled={!enabled} className={className}>
        {label}
      </button>
    </AssemblyCommandForm>
  );
}

const confirmId = 'ready-confirm';

/**
 * What a seat agrees to by readying, asked only when I'm ready is pressed:
 * the ranked waiver while unsigned, the casual capture notice, the post-round
 * call. A native popover, so it opens without script; null when there is
 * nothing to ask.
 */
function ReadyConfirm({
  view,
  waiverAction,
  ready,
}: {
  readonly view: View;
  readonly waiverAction: FormAction<RoomFormState>;
  readonly ready: ReactNode;
}) {
  const waiver = view.contentWaiver === 'unsigned';
  const call = freezePostRoundCall(view.postRoundCall, view.participants);
  if (!waiver && !view.captureNotice && !call) return null;
  return (
    <div
      id={confirmId}
      popover="auto"
      role="dialog"
      aria-labelledby={`${confirmId}-title`}
      className="m-auto w-room-dialog max-w-full flex-col gap-4 rounded-lg border border-border-strong bg-surface p-6 text-ink shadow-3 backdrop:bg-scrim/50 open:flex"
    >
      <h2 id={`${confirmId}-title`} className="font-display text-lg">
        Ready?
      </h2>
      {waiver ? (
        <ContentWaiverForm action={waiverAction} />
      ) : (
        <>
          {view.captureNotice ? (
            <p className="text-sm">{view.captureNotice.text}</p>
          ) : null}
          {call ? <p className="text-sm">{postRoundCallText}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              popoverTarget={confirmId}
              popoverTargetAction="hide"
              className={buttonClass('secondary')}
            >
              Cancel
            </button>
            {ready}
          </div>
        </>
      )}
    </div>
  );
}

function startBlocked(view: View, actorId: string, local: LocalReadiness) {
  const admissionBlocked =
    view.botAdmission !== null &&
    (view.botAdmission.kind === 'unavailable' ||
      (view.botAdmission.kind === 'allowance' &&
        view.botAdmission.refusal !== null));
  return (
    !view.capabilities.canStart ||
    startFence(view, actorId, local) ||
    admissionBlocked
  );
}

/**
 * The viewer's one full-width button under their tile: Turn on camera and
 * mic, then I'm ready, then Not ready; for the host, Start round once they
 * are ready (or at once when they hold no seat). The roster only shows each
 * seat's Ready mark. Null for bots, spectators and unseated members.
 */
export function ReadyControl({
  view,
  actorId,
  local,
  action,
  waiverAction,
  commandIds,
  turnOnDevices,
}: Props) {
  const ready = readinessControl(view, actorId, local);
  const host = view.capabilities.host;
  const start = host
    ? CommandForm({
        type: 'start-round',
        label: 'Start round',
        enabled: !startBlocked(view, actorId, local),
        version: view.version,
        commandId: commandIds['start-round'],
        action,
        className: `${buttonClass('primary')} w-full`,
      })
    : null;
  if (!ready)
    return start ? <div className="flex flex-col">{start}</div> : null;
  const own = ownSeat(view, actorId);
  const full = (variant: 'primary' | 'secondary') =>
    `${buttonClass(variant)} w-full`;
  if (ready.type === 'unready')
    return (
      <div className="flex flex-col gap-2">
        {start}
        {CommandForm({
          type: 'unready',
          label: 'Not ready',
          enabled: ready.enabled,
          version: view.version,
          commandId: commandIds.unready,
          action,
          expectedConsentVersion: own?.consentVersion ?? null,
          className: start
            ? `${buttonClass('ghost')} w-full`
            : full('secondary'),
        })}
      </div>
    );
  // The only refusal the viewer can clear from here is their own devices.
  if (ready.blocker === 'devices' && turnOnDevices)
    return (
      <button type="button" onClick={turnOnDevices} className={full('primary')}>
        Turn on camera and mic
      </button>
    );
  const readyForm = (className: string) =>
    CommandForm({
      type: 'ready',
      label: 'I’m ready',
      enabled: ready.enabled,
      version: view.version,
      commandId: commandIds.ready,
      action,
      expectedConsentVersion: own?.consentVersion ?? null,
      noticeVersion: view.captureNotice?.version ?? null,
      className,
    });
  const confirm = ReadyConfirm({
    view,
    waiverAction,
    ready: readyForm(buttonClass('primary')),
  });
  const askable = ready.enabled || ready.blocker === 'waiver';
  return (
    <div className="flex flex-col gap-2">
      {confirm && askable ? (
        <>
          <button
            type="button"
            popoverTarget={confirmId}
            className={full('primary')}
          >
            I’m ready
          </button>
          {confirm}
        </>
      ) : (
        readyForm(full('primary'))
      )}
      {ready.reason && !askable ? (
        <p role="status" className="text-sm text-ink-muted">
          {ready.reason}
        </p>
      ) : null}
    </div>
  );
}

/** What Start waits on, the roster's last line; the host's Start round is under their tile. */
export function StartControl({ view, actorId, local }: Props) {
  const waiting = waitingOn(view, actorId);
  const notice =
    waiting.length > 0
      ? `Waiting on ${waiting.join(', ')}`
      : view.capabilities.host && startFence(view, actorId, local)
        ? 'Waiting on your camera and mic'
        : view.startRefusal
          ? `Waiting on ${startRefusalText(view.startRefusal)}`
          : 'Everyone is ready';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {view.capabilities.host ? (
        <BotAdmissionNotice admission={view.botAdmission} />
      ) : null}
      <p role="status" className="text-right text-sm text-ink-muted">
        {notice}
      </p>
    </div>
  );
}
