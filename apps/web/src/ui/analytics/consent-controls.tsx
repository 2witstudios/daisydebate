import Link from 'next/link';
import {
  consentNeeded,
  type AnalyticsAvailability,
  type Consent,
} from '../../features/analytics/consent';
import { buttonClass } from '../components/button/button-class';

type ConsentControlsProps = {
  readonly consent: Consent;
  readonly available: AnalyticsAvailability;
  readonly banner?: boolean;
  /** The stored choice could not be read: `consent` is not it, so offer no form. */
  readonly consentUnreadable?: boolean;
};

export function ConsentControls({
  consentUnreadable = false,
  ...form
}: ConsentControlsProps) {
  const { analytics, replay } = form.available;
  if (!analytics && !replay) return null;
  if (consentUnreadable)
    return (
      <p role="status">
        We can&apos;t read your saved privacy choices right now. Reload this
        page to try again.
      </p>
    );
  return <ConsentForm {...form} />;
}

function ConsentForm({
  consent,
  available,
  banner = false,
}: Omit<ConsentControlsProps, 'consentUnreadable'>) {
  if (banner && consentNeeded(consent, available).length === 0) return null;
  return (
    <aside
      aria-label="Analytics preferences"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 text-ink shadow-1"
    >
      <h2 className="font-display text-xl font-bold">Your privacy choices</h2>
      <p>
        Optional analytics helps us improve Daisy. Choose whether to share
        product usage. Necessary storage always stays on. You can change your
        choice at any time.
      </p>
      <form
        key={`${consent.analytics}:${consent.replay}`}
        action="/api/analytics/consent"
        method="post"
        className="flex flex-col gap-4"
      >
        {banner && <input type="hidden" name="scope" value="unanswered" />}
        {!banner && (
          <div className="flex flex-col gap-3">
            {available.analytics && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="analytics"
                  defaultChecked={consent.analytics === 'granted'}
                />
                Product analytics
              </label>
            )}
            {available.replay && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="replay"
                  defaultChecked={consent.replay === 'granted'}
                />
                Masked session replay
              </label>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {banner ? (
            <button
              name="choice"
              value="accept"
              className={buttonClass('secondary')}
            >
              Accept optional
            </button>
          ) : (
            <button
              name="choice"
              value="save"
              className={buttonClass('secondary')}
            >
              Save choices
            </button>
          )}
          <button
            name="choice"
            value="deny"
            className={buttonClass('secondary')}
          >
            Reject optional
          </button>
          {banner && (
            <Link href="/analytics" className={buttonClass('ghost')}>
              Choose preferences
            </Link>
          )}
        </div>
      </form>
      <Link href="/privacy" className="text-sm underline">
        Privacy policy
      </Link>
    </aside>
  );
}
