import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../../features/messaging/channel-page';
import { PageHeader } from '../../../../../../ui/components/page-header/page-header';
import { GroupManagementForm } from '../../../../../../ui/messaging/group-management-form';
import { manageGroupAction } from './actions';
const labels = {
  invite: 'Invite a person',
  remove: 'Remove a member',
  transfer: 'Transfer management',
  leave: 'Leave group',
  archive: 'Archive group',
} as const;
export const metadata = { title: 'Group membership' };
export default async function GroupManagementPage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  await requireAccess('/messages', searchParams);
  const id = idSchema.safeParse((await params).channelId);
  if (!id.success) notFound();
  const selected = (await searchParams).operation;
  const operation =
    selected === 'invite' ||
    selected === 'remove' ||
    selected === 'transfer' ||
    selected === 'archive'
      ? selected
      : 'leave';
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Group membership"
        actions={
          <Link href={`/messages/${id.data}`}>Back to conversation</Link>
        }
      />
      <nav
        aria-label="Group membership actions"
        className="flex flex-wrap gap-4"
      >
        {Object.entries(labels).map(([kind, label]) => (
          <Link
            key={kind}
            href={`/messages/groups/${id.data}/manage?operation=${kind}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <GroupManagementForm
        key={operation}
        title={labels[operation]}
        targeted={
          operation === 'invite' ||
          operation === 'remove' ||
          operation === 'transfer'
        }
        requestId={systemId.next()}
        action={manageGroupAction.bind(null, id.data, operation)}
      />
    </main>
  );
}
