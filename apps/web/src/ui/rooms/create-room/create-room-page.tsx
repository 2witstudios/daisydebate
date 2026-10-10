import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import type { MockFormAction } from '../../form-action/mock-form';
import { cn } from '../../cn';
import { CreateAssemblyForm } from './create-assembly-form';
import type { RoomTemplate } from '../../../features/rooms/read-catalog';

const linkButton = 'no-underline hover:no-underline';

/** Select a stored template, then configure and cast the durable room. */
export function CreateRoomPage({
  action,
  commandId,
  choices,
}: {
  readonly action: MockFormAction;
  readonly commandId: string;
  readonly choices: readonly RoomTemplate[];
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="Create a room"
        actions={
          <Link
            href="/lobby"
            className={cn(buttonClass('secondary'), linkButton)}
          >
            Browse open rooms
          </Link>
        }
      />
      <div className="flex items-start gap-6 max-compact:flex-col max-compact:gap-4">
        <section
          aria-label="Room settings"
          className="flex min-w-0 flex-1 flex-col gap-6 rounded-xl bg-surface p-6 shadow-1 max-compact:w-full"
        >
          <CreateAssemblyForm
            action={action}
            commandId={commandId}
            choices={choices}
          />
        </section>
        <aside
          aria-label="About practice rooms"
          className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
        >
          <Notice tone="accent" icon="trophy" title="This room is unranked">
            <Link href="/ranked/host">Host a ranked table</Link>
          </Notice>
        </aside>
      </div>
    </div>
  );
}
