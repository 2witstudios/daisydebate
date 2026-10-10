import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { idSchema, messagingPreferenceSchemas } from '@daisy/protocol';
import { requireAccess } from '../../../../../lib/access';
import type { MessagingChannelPageProps } from '../../../../../features/messaging/channel-page';
import { PreferenceForm } from '../../../../../ui/messaging/preference-form';
import { GET } from '../../../../api/messaging/channels/[channelId]/preferences/route';
import { changePreferenceAction } from './actions';
import { preferenceFormState } from '../../../../../features/messaging/forms/preference-form';
export const metadata = { title: 'Conversation preferences' };
export default async function PreferencePage({
  params,
  searchParams,
}: MessagingChannelPageProps) {
  await requireAccess('/messages', searchParams);
  const parsed = idSchema.safeParse((await params).channelId);
  if (!parsed.success) notFound();
  const channelId = parsed.data;
  const response = await GET(
    new Request(
      `http://in-process.invalid/api/messaging/channels/${channelId}/preferences`,
      { headers: new Headers(await headers()) },
    ),
    { params: Promise.resolve({ channelId }) },
  );
  const result = response.ok
    ? messagingPreferenceSchemas.result.safeParse(await response.json())
    : null;
  const state = result?.success ? result.data.state : null;
  return (
    <main className="mx-auto flex w-full max-w-reading flex-col gap-6 p-6">
      <h1>Conversation preferences</h1>
      {result?.success ? (
        <>
          <p>Unread messages: {result.data.unread}</p>
          <p>Preferences do not change who can access this conversation.</p>
        </>
      ) : (
        <p role="status">
          Preferences are unavailable. You can still try clearing your own saved
          state.
        </p>
      )}
      <PreferenceForm
        state={preferenceFormState(state)}
        action={changePreferenceAction.bind(null, channelId)}
      />
      <Link href={`/messages/${channelId}`}>Back to conversation</Link>
    </main>
  );
}
