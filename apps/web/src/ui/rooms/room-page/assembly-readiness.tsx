import { BotAdmissionNotice } from './bot-admission-notice';
import { AssemblyCommandForm } from './assembly-command-form';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { isNamedSeat, type RoomView } from '@daisy/protocol';
import { AssemblyCommandFields } from './assembly-command-fields';
import { buttonClass } from '../../components/button/button-class';
import { readinessControl, type LocalReadiness } from './assembly-controls';
import { startRefusalText, waitingOn } from './room-labels';
import type { ReactNode } from 'react';

type Control = 'ready' | 'unready' | 'start-round';
type View = Pick<
  RoomView,
  'participants' | 'version' | 'readiness' | 'startRefusal' | 'botAdmission'
> & {
  readonly definition: Pick<RoomView['definition'], 'seats'>;
  readonly prep: RoomView['prep'];
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
  readonly commandIds: Readonly<Record<Control, string>>;
};

function startFence(
  view: View,
  actorId: string,
  local: LocalReadiness,
): boolean {
  if (local.unreadyPending) return true;
  const own = view.participants
    .filter(isNamedSeat)
    .find((seat) => seat.actorId === actorId);
  return own?.kind === 'human' && own.role !== 'judge' && !local.devicesPassed;
}

/** One native versioned room command; CAP validates every value again. */
export function CommandForm({
  type,
  version,
  commandId,
  action,
  label,
  enabled,
  expectedConsentVersion = null,
  className,
}: {
  readonly type: Control | 'start-pre-round' | 'finish-prep';
  readonly version: number;
  readonly commandId: string;
  readonly action: FormAction<RoomFormState>;
  readonly label: string;
  readonly enabled: boolean;
  readonly expectedConsentVersion?: number | null;
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
      <button type="submit" disabled={!enabled} className={className}>
        {label}
      </button>
    </AssemblyCommandForm>
  );
}

/** The viewer's own Ready or Not ready; null for bots, spectators and unseated members. */
export function ReadyControl({
  view,
  actorId,
  local,
  action,
  commandIds,
}: Props) {
  const ready = readinessControl(view, actorId, local);
  if (!ready) return null;
  const own = view.participants
    .filter(isNamedSeat)
    .find((seat) => seat.actorId === actorId);
  const isReady = ready.type === 'unready' && !local.unreadyPending;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {ready.reason ? (
        <p role="status" className="mr-auto text-sm text-ink-muted">
          {ready.reason}
        </p>
      ) : null}
      {isReady ? (
        <span className="rounded-full bg-hue-teal-soft px-3 py-1 text-sm font-semibold text-hue-teal">
          ✓ Ready
        </span>
      ) : null}
      {CommandForm({
        type: ready.type,
        label: ready.type === 'ready' ? 'I’m ready' : 'Not ready',
        enabled: ready.enabled,
        version: view.version,
        commandId: commandIds[ready.type],
        action,
        expectedConsentVersion: own?.consentVersion ?? null,
        className: buttonClass(
          ready.type === 'ready' ? 'primary' : 'secondary',
        ),
      })}
    </div>
  );
}

function startNotice(
  view: View,
  actorId: string,
  blocked: boolean,
): string | null {
  const waiting = waitingOn(view, actorId);
  if (waiting.length > 0) return `Waiting on: ${waiting.join(', ')}`;
  if (blocked) return 'Waiting on: your camera and microphone check';
  if (view.startRefusal)
    return `Waiting on ${startRefusalText(view.startRefusal)}`;
  return 'Everyone is here and ready.';
}

/** The Start card: what it waits on for everyone, Start round for the host, then prep. */
export function StartControl({
  view,
  actorId,
  local,
  action,
  commandIds,
  prep,
}: Props & { readonly prep: ReactNode }) {
  const blocked = startFence(view, actorId, local);
  const admissionBlocked =
    view.botAdmission !== null &&
    (view.botAdmission.kind === 'unavailable' ||
      (view.botAdmission.kind === 'allowance' &&
        view.botAdmission.refusal !== null));
  const notice = startNotice(view, actorId, blocked);
  return (
    <section
      aria-labelledby="room-start-title"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <h2 id="room-start-title" className="text-md font-semibold">
        Start the round
      </h2>
      <p role="status" className="text-sm text-ink-muted">
        {notice}
      </p>
      {view.capabilities.host ? (
        <BotAdmissionNotice admission={view.botAdmission} />
      ) : null}
      {view.capabilities.host ? (
        CommandForm({
          type: 'start-round',
          label: 'Start round',
          enabled: view.capabilities.canStart && !blocked && !admissionBlocked,
          version: view.version,
          commandId: commandIds['start-round'],
          action,
          className: `${buttonClass('primary')} w-full`,
        })
      ) : (
        <p className="text-sm text-ink-muted">The host starts the round.</p>
      )}
      {prep}
    </section>
  );
}
