import type { Metadata } from 'next';
import { idSchema } from '@daisy/protocol';
import { redirect } from 'next/navigation';
import type { SearchParams } from '../../../features/access/decision';
import { driveNoticeText } from '../../../features/documents/drive-return';
import { requireAccess } from '../../../lib/access';
import { DocumentManager } from '../../../ui/documents/document-manager';
import { requestMemberDrive } from '../../../lib/request-session';

export const metadata: Metadata = { title: 'Prep' };

/** Prep is where a member's documents open: one tree, the same as in a Round. */
export default async function PrepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/prep', searchParams);
  const drive = requestMemberDrive(identity);
  if (drive === null) redirect('/');
  const { principal, operations } = drive;
  const [page, folders, params] = await Promise.all([
    operations.listDrive(principal, { folderId: null, after: null }),
    operations.listFolders(principal),
    searchParams,
  ]);
  return (
    <div data-workspace className="flex min-h-0 flex-1 flex-col">
      <DocumentManager
        principalId={principal.userId}
        back="/prep"
        initial={{ folderId: null, ...page, folders }}
        notice={driveNoticeText(params.notice)}
        openId={
          typeof params.open === 'string' &&
          idSchema.safeParse(params.open).success
            ? params.open
            : null
        }
      />
    </div>
  );
}
