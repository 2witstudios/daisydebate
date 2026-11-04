import type { Metadata } from 'next';
import { idSchema } from '@daisy/protocol';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../features/access/decision';
import { driveNoticeText } from '../../../../../features/documents/drive-return';
import { requireAccess } from '../../../../../lib/access';
import { DocumentManager } from '../../../../../ui/documents/document-manager';
import { requestMemberDrive } from '../../../../../lib/request-session';

export const metadata: Metadata = { title: 'Prep' };

/** One folder as its own page, so a drive can be walked without script. */
export default async function PrepFolderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const identity = await requireAccess('/prep', searchParams);
  if (!idSchema.safeParse(id).success) notFound();
  const drive = requestMemberDrive(identity);
  if (drive === null) redirect('/');
  const { principal, operations } = drive;
  const folders = await operations.listFolders(principal);
  const folder = folders.find((one) => one.id === id);
  if (!folder) notFound();
  const page = await operations.listDrive(principal, {
    folderId: id,
    after: null,
  });
  return (
    <>
      <Link href="/prep" className="px-6 text-sm underline">
        Back to My drive
      </Link>
      <DocumentManager
        principalId={principal.userId}
        back={`/prep/folders/${id}`}
        title={folder.name}
        initial={{ folderId: id, ...page, folders }}
        notice={driveNoticeText((await searchParams).notice)}
      />
    </>
  );
}
