import Link from 'next/link';
import type { UnsubscribeView } from '../../../features/notifications/email/unsubscribe-view';
import { buttonClass } from '../../components/button/button-class';

/**
 * Stops notification email from the email's own link, with no sign-in (ADR
 * 0124, ADR 0144). A native form, so it works without JavaScript.
 */
export function UnsubscribePage({ view }: { readonly view: UnsubscribeView }) {
  return (
    <main className="mx-auto flex max-w-reading flex-col gap-4 px-4 py-10">
      <h1 className="font-display text-2xl text-ink">Email preferences</h1>
      {view.kind === 'confirm' ? (
        <form
          method="post"
          action="/api/notifications/unsubscribe"
          className="flex flex-col gap-4"
        >
          <p className="text-base text-ink">
            Stop notification emails from Daisy? You still see everything in
            Daisy, and sign-in and account emails are unchanged.
          </p>
          <input type="hidden" name="from" value="page" />
          <input type="hidden" name="u" value={view.fields.u} />
          <input type="hidden" name="t" value={view.fields.t} />
          <div>
            <button type="submit" className={buttonClass('primary')}>
              Stop notification emails
            </button>
          </div>
        </form>
      ) : view.kind === 'done' ? (
        <p role="status" className="text-base text-ink">
          Done. Daisy will not email you about notifications. You can turn them
          back on, or choose which kinds, in{' '}
          <Link href="/settings">Settings</Link>.
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
