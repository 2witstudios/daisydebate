import { Button } from '../../components/button/button';
import { StatusRegion } from '../../components/status-region/status-region';
import Link from 'next/link';
import type { UnsubscribeView } from '../../../features/notifications/email/unsubscribe-view';

/**
 * Stops notification email from the email's own link, with no sign-in (ADR
 * 0124, ADR 0144). A native form, so it works before hydration.
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
            <Button variant="primary" type="submit">
              Stop notification emails
            </Button>
          </div>
        </form>
      ) : view.kind === 'done' ? (
        <StatusRegion as="p" role="status" className="text-base text-ink">
          Done. Daisy will not email you about notifications. You can turn them
          back on, or choose which kinds, in{' '}
          <Link href="/settings">Settings</Link>.
        </StatusRegion>
      ) : (
        <StatusRegion as="p" role="status" className="text-base text-ink">
          This link is not valid. You can choose which emails you get in{' '}
          <Link href="/settings">Settings</Link>.
        </StatusRegion>
      )}
    </main>
  );
}
