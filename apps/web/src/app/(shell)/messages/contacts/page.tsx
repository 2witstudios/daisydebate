import Link from 'next/link';
import { systemId } from '@daisy/clock';
import { requireAccess } from '../../../../lib/access';
import type { SearchParams } from '../../../../features/access/decision';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { ContactBlockForm } from '../../../../ui/messaging/contact-block-form';
import { blockContactAction } from './actions';
export const metadata = { title: 'Contact safety' };
export default async function ContactSafetyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/messages/contacts', searchParams);
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <PageHeader
        title="Contact safety"
        actions={<Link href="/messages">Back to messages</Link>}
      />
      <p>
        Block someone to prevent new private messages between you. Unblocking
        does not accept a message request.
      </p>
      <ContactBlockForm
        requestId={systemId.next()}
        action={blockContactAction}
      />
    </main>
  );
}
