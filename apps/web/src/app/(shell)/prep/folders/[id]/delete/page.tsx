import type { Metadata } from 'next';
import { idSchema } from '@daisy/protocol';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../../../../../../features/access/decision';
import { requireAccess } from '../../../../../../lib/access';
import { requestMemberDrive } from '../../../../../../lib/request-session';

export const metadata: Metadata = { title: 'Delete folder' };

/** A folder's deletion says how much goes before anything does. */
export default async function DeleteFolderPage({
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
  const folder = (await operations.listFolders(principal)).find(
    (one) => one.id === id,
  );
  if (!folder) notFound();
  const count = await operations.folderDocumentCount(principal, { id });
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-3 p-6">
      <h1 className="text-lg font-bold">Delete {folder.name}?</h1>
      <p>
        This deletes the folder, the folders inside it and{' '}
        {count === 1 ? '1 document' : `${count} documents`} for good. They
        cannot be restored.
      </p>
      <form method="post" action="/api/documents/folders/delete">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="back" value="/prep" />
        <button
          type="submit"
          className="h-room-target cursor-pointer rounded-sm bg-accent px-4 text-sm font-strong text-accent-ink"
        >
          Delete {folder.name}
        </button>
      </form>
      <Link href="/prep" className="text-sm underline">
        Keep it
      </Link>
    </main>
  );
}
