import { isNamedSeat, type RoomView } from '@daisy/protocol';
import Link from 'next/link';
import type { RoomFormState } from '../../../features/rooms/command-answer';
import type { FormAction } from '../../form-action/form-action';
import { buttonClass } from '../../components/button/button-class';
import { AssemblyCommandFields } from './assembly-command-fields';
import { AssemblyCommandForm } from './assembly-command-form';
import { roomChips } from './room-labels';
import { AssemblyDetails } from './assembly-details';
import { RoomInvite } from './room-invite';

const visibilityLabels = {
  public: 'Public',
  unlisted: 'Unlisted',
  private: 'Private',
} as const;

export function AssemblyHeader({
  view,
  actorId,
  commandIds,
  detailsAction,
  commandAction,
}: {
  readonly view: RoomView;
  readonly actorId: string;
  readonly commandIds: {
    readonly details: string;
    readonly leave: string;
    readonly close: string;
  };
  readonly detailsAction: FormAction<RoomFormState>;
  readonly commandAction: FormAction<RoomFormState>;
}) {
  const [status, shape, competition] = roomChips(view);
  const host = view.hostActorId === actorId;
  const seated = view.participants
    .filter(isNamedSeat)
    .some((seat) => seat.actorId === actorId);
  return (
    <header className="flex flex-col gap-3">
      <Link
        href="/lobby"
        className="inline-flex min-h-12 items-center self-start text-sm text-ink-muted"
      >
        ‹ Lobby
      </Link>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-hue-teal-soft px-3 py-1 text-hue-teal">
              {status}
            </span>
            <span className="rounded-full border border-border-strong px-3 py-1 text-ink-muted">
              {shape}
            </span>
            <span className="rounded-full border border-border-strong px-3 py-1 text-ink-muted">
              {competition}
            </span>
          </p>
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight wrap-anywhere">
            {view.topic}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-muted">
            <span className="min-w-0 wrap-anywhere">{view.title}</span>
            {view.hostLabel !== null ? (
              <span className="min-w-0 wrap-anywhere">
                Hosted by {view.hostLabel}
              </span>
            ) : null}
            <span>{visibilityLabels[view.visibility]}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <RoomInvite
            roomId={view.id}
            visibility={view.visibility}
            label="Copy invite link"
          />
          {host ? (
            // The host leaving closes the Room (ADR 0069), so the host gets Close.
            <AssemblyCommandForm action={commandAction}>
              <AssemblyCommandFields
                type="close"
                version={view.version}
                commandId={commandIds.close}
              />
              <button type="submit" className={buttonClass('secondary')}>
                Close room
              </button>
            </AssemblyCommandForm>
          ) : seated ? (
            <AssemblyCommandForm action={commandAction}>
              <AssemblyCommandFields
                type="leave-seat"
                version={view.version}
                commandId={commandIds.leave}
              />
              <button type="submit" className={buttonClass('secondary')}>
                Leave seat
              </button>
            </AssemblyCommandForm>
          ) : null}
        </div>
      </div>
      {view.capabilities.canEdit ? (
        <AssemblyDetails
          view={view}
          commandId={commandIds.details}
          action={detailsAction}
        />
      ) : null}
    </header>
  );
}
