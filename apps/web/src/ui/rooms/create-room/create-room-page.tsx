import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';
import { Notice } from '../../components/notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import type { MockFormAction } from '../../form-action/mock-form';
import { cn } from '../../cn';
import { CreateRoomForm } from './create-room-form';

const linkButton = 'no-underline hover:no-underline';

/** Opening a practice room: the settings, then the room itself. */
export function CreateRoomPage({
  action,
}: {
  readonly action: MockFormAction;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="Open a practice room"
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
          <CreateRoomForm action={action} />
        </section>
        <aside
          aria-label="About practice rooms"
          className="flex w-rail shrink-0 flex-col gap-4 max-compact:w-full"
        >
          <Notice tone="accent" icon="trophy" title="Practice is unranked">
            <Link href="/ranked/host">Host a ranked table</Link>
          </Notice>
        </aside>
      </div>
    </div>
  );
}
