import { ConversationPane } from '../../../../../../ui/messaging/conversation-pane';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { systemId } from '@daisy/clock';
import { idSchema } from '@daisy/protocol';
import { requireAccess } from '../../../../../../lib/access';
import { privateGroupsOffered } from '../../../../../../lib/request-session';
import type { MessagingChannelPageProps } from '../../../../../../features/messaging/channel-page';
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
  // ISSUE-643: no invitations while private groups are off; members may
  // still leave, and managers remove, transfer and archive.
  const offered = Object.fromEntries(
    Object.entries(labels).filter(
      ([kind]) => kind !== 'invite' || privateGroupsOffered(),
    ),
  );
  const operation =
    (selected === 'invite' && 'invite' in offered) ||
    selected === 'remove' ||
    selected === 'transfer' ||
    selected === 'archive'
      ? selected
      : 'leave';
  return (
    <ConversationPane title="Group membership">
      <nav
        aria-label="Group membership actions"
        className="flex flex-wrap gap-4"
      >
        {Object.entries(offered).map(([kind, label]) => (
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
    </ConversationPane>
  );
}
