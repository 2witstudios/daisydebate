import type { EmailedNotificationKind } from '@daisy/protocol';
import Link from 'next/link';
import type { UnsubscribeView } from '../../../features/notifications/email/unsubscribe-view';
import { buttonClass } from '../../components/button/button-class';

const kindWords: Record<EmailedNotificationKind, string> = {
  room_invitation: 'room invitations',
  challenge_received: 'challenges',
};

/**
 * Turns off one kind of notification email from the email's own link, with
 * no sign-in (ADR 0124). A native form, so it works without JavaScript.
 */
export function UnsubscribePage({ view }: { readonly view: UnsubscribeView }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10">
      <h1 className="font-display text-2xl text-ink">Email preferences</h1>
      {view.kind === 'confirm' ? (
        <form
          method="post"
          action="/api/notifications/unsubscribe"
          className="flex flex-col gap-4"
        >
          <p className="text-base text-ink">
            Stop emails about {kindWords[view.subject]}? You still see them in
            Daisy, and other emails are unchanged.
          </p>
          <input type="hidden" name="from" value="page" />
          <input type="hidden" name="u" value={view.fields.u} />
          <input type="hidden" name="k" value={view.fields.k} />
          <input type="hidden" name="t" value={view.fields.t} />
          <div>
            <button type="submit" className={buttonClass('primary')}>
              Stop these emails
            </button>
          </div>
        </form>
      ) : view.kind === 'done' ? (
        <p role="status" className="text-base text-ink">
          Done. You will not get emails about {kindWords[view.subject]}. You
          can turn them back on in <Link href="/settings">Settings</Link>.
        </p>
      ) : (
        <p role="status" className="text-base text-ink">
          This link is not valid. You can choose which emails you get in{' '}
          <Link href="/settings">Settings</Link>.
        </p>
      )}
    </main>
  );
}
