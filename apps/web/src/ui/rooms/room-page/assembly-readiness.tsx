import { AssemblyCommandForm } from './assembly-command-form';
import type { MockFormState } from '../../../features/mock-form/form';
import type { FormAction } from '../../form-action/form-action';
import type { RoomView } from '@daisy/protocol';
import { AssemblyCommandFields } from './assembly-command-fields';
import { buttonClass } from '../../components/button/button-class';
import { readinessControl, type LocalReadiness } from './assembly-controls';

type Control =
  'ready' | 'unready' | 'start-prep' | 'finish-prep' | 'start-round';
type View = Pick<
  RoomView,
  'participants' | 'version' | 'readiness' | 'startRefusal'
> & {
  readonly capabilities: Pick<
    RoomView['capabilities'],
    'canReady' | 'host' | 'canStart' | 'canStartPrep' | 'canFinishPrep'
  >;
};

function launchFence(
  view: View,
  actorId: string,
  local: LocalReadiness,
): boolean {
  if (local.unreadyPending) return true;
  const own = view.participants.find((seat) => seat.actorId === actorId);
  return own?.kind === 'human' && own.role !== 'judge' && !local.devicesPassed;
}

function launchNotice(blocked: boolean, refusal: View['startRefusal']) {
  if (blocked)
    return (
      <p role="status" className="text-sm text-ink-muted">
        Confirm your current readiness before Launch.
      </p>
    );
  if (refusal)
    return (
      <p className="text-sm text-ink-muted">
        Launch is waiting: {refusal.replaceAll('-', ' ')}.
      </p>
    );
  return null;
}

function CommandForm({
  type,
  version,
  commandId,
  action,
  label,
  enabled,
  expectedConsentVersion,
}: {
  readonly type: Control;
  readonly version: number;
  readonly commandId: string;
  readonly action: FormAction<MockFormState>;
  readonly label: string;
  readonly enabled: boolean;
  readonly expectedConsentVersion: number | null;
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
      <button
        type="submit"
        disabled={!enabled}
        className={buttonClass(type === 'unready' ? 'secondary' : 'primary')}
      >
        {label}
      </button>
    </AssemblyCommandForm>
  );
}

/** Native commands use a trusted server action; this renderer grants no authority. */
export function AssemblyReadiness({
  view,
  actorId,
  local,
  action,
  commandIds,
}: {
  readonly view: View;
  readonly actorId: string;
  readonly local: LocalReadiness;
  readonly action: FormAction<MockFormState>;
  readonly commandIds: Readonly<Record<Control, string>>;
}) {
  const ready = readinessControl(view, actorId, local);
  const launchBlocked = launchFence(view, actorId, local);
  const own = view.participants.find((seat) => seat.actorId === actorId);
  const command = (type: Control, label: string, enabled: boolean) =>
    CommandForm({
      type,
      label,
      enabled,
      version: view.version,
      commandId: commandIds[type],
      action,
      expectedConsentVersion:
        type === 'ready' || type === 'unready'
          ? (own?.consentVersion ?? null)
          : null,
    });
  return (
    <section
      aria-label="Readiness and Launch"
      className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-1"
    >
      {ready ? (
        <div className="flex flex-col gap-2">
          {command(
            ready.type,
            ready.type === 'ready' ? 'I am ready' : 'Not ready',
            ready.enabled,
          )}
          {ready.reason ? (
            <p role="status" className="text-sm text-ink-muted">
              {ready.reason}
            </p>
          ) : null}
        </div>
      ) : null}
      {view.capabilities.host ? (
        <div className="flex flex-col gap-2">
          {view.capabilities.canStartPrep
            ? command('start-prep', 'Start preparation', true)
            : null}
          {view.capabilities.canFinishPrep
            ? command('finish-prep', 'Finish preparation', true)
            : null}
          {command(
            'start-round',
            'Launch',
            view.capabilities.canStart && !launchBlocked,
          )}
          {launchNotice(launchBlocked, view.startRefusal)}
        </div>
      ) : null}
    </section>
  );
}
