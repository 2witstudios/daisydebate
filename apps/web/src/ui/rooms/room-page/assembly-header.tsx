import type { RoomView } from '@daisy/protocol';
import Link from 'next/link';
import type { MockFormState } from '../../../features/mock-form/form';
import type { FormAction } from '../../form-action/form-action';
import { AssemblyDetails } from './assembly-details';
import { RoomInvite } from './room-invite';

export function AssemblyHeader({
  view,
  commandId,
  action,
}: {
  readonly view: RoomView;
  readonly commandId: string;
  readonly action: FormAction<MockFormState>;
}) {
  return (
    <header className="flex flex-col gap-5">
      <Link href="/lobby" className="text-sm text-ink-muted">
        ‹ Lobby
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4 max-narrow:flex-col">
        <div className="min-w-0 flex-1 max-narrow:w-full">
          <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight wrap-anywhere max-narrow:text-2xl">
            {view.topic}
          </h1>
          <p className="mt-3 text-sm wrap-anywhere text-ink-muted">
            {view.title}
          </p>
          <p className="mt-2 flex flex-wrap gap-3 text-sm text-ink-muted">
            <span className="min-w-0 wrap-anywhere">
              Hosted by {view.hostLabel}
            </span>
            <span>{view.visibility}</span>
            <span>
              {view.competitionType} · {view.status}
            </span>
          </p>
        </div>
        <RoomInvite roomId={view.id} visibility={view.visibility} />
      </div>
      {view.capabilities.canEdit ? (
        <AssemblyDetails view={view} commandId={commandId} action={action} />
      ) : null}
    </header>
  );
}
